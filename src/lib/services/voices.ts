import "server-only";
import { canDeleteVoice } from "@/lib/privacy";
import { randomBytes } from "node:crypto";
import { transcribeVoice } from "../ai";
import { convertToWavPcm } from "../audio/convert";
import { canAcceptVoice, validateSourcedQuote } from "../book/lifecycle";
import { shouldTranslate, dropStartWord, spokenStartWord, wavDurationMs } from "../book/speech";
import type { Turn } from "../book/types";
import { prisma } from "../db";
import { FAMOUS_SAMPLES, SAMPLE_PREFIX, xPostDate } from "../famous-quotes";
import { AppError } from "../errors";
import { countryByCode } from "../countries";
import { languageByCode } from "../languages";
import { AGE_BANDS } from "../regions";
import { ENGLISH_START_WORDS, missingStartWordMessage, pickStartWord } from "../start-words";
import { deleteAudio, getAudio, putAudio } from "../storage";
import { getConfig } from "../config";
import { transcriberLive } from "../ai/providers";
import { settleVoice, voicesLeftToday } from "./pipeline";
import { recordUsage, spendPaused } from "./spend";
import { syncClosed } from "./books";

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_MS = 10 * 60 * 1000;

export async function issueChallenge(bookId: string, language: string, preferred?: string) {
  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book) throw new AppError("This book does not exist.", 404);
  const chosen = languageByCode(language);
  const fixed =
    preferred && !(await transcriberLive(bookId))
      ? ENGLISH_START_WORDS.findIndex((word) => word.toLowerCase() === preferred.toLowerCase())
      : -1;
  const picked = pickStartWord(chosen.code, fixed >= 0 ? fixed : randomBytes(2).readUInt16BE(0));
  const challenge = await prisma.voiceChallenge.create({
    data: {
      bookId,
      language: chosen.code,
      startWord: picked.word,
      expiresAt: new Date(Date.now() + 20 * 60 * 1000),
    },
  });
  return {
    challengeId: challenge.id,
    startWord: challenge.startWord,
    english: picked.english,
    language: challenge.language,
    languageName: chosen.name,
  };
}

export async function ingestRecording(input: {
  bookId: string;
  viewerId: string | null;
  /** Hashed guest key of a signed-out contributor's browser, so they can find and delete their own voice. */
  guestKey?: string;
  invite: string | null;
  challengeId: string;
  name: string;
  countryCode: string | null;
  handle: string;
  ageBand: string;
  region: string;
  consent: boolean;
  durationMs: number;
  clientTranscript: string | null;
  audio: Buffer;
  mimeType: string;
  ip: string;
}) {
  if (!input.consent) throw new AppError("Consent is required before a voice can be kept.");
  const name = cleanName(input.name);

  const found = await prisma.book.findUnique({ where: { id: input.bookId } });
  if (!found) throw new AppError("This book does not exist.", 404);
  const closed = await syncClosed(found);
  const book = { ...found, status: closed.status, closesAt: closed.closesAt };
  const challenge = await prisma.voiceChallenge.findUnique({ where: { id: input.challengeId } });
  if (!challenge || challenge.bookId !== book.id || challenge.consumedAt || challenge.expiresAt.getTime() < Date.now()) {
    throw new AppError("Say the word on the page. Ask for a new word if this one expired.");
  }

  const gate = canAcceptVoice({
    bookType: book.type,
    status: book.status,
    closesAt: book.closesAt?.getTime() ?? null,
    creatorId: book.creatorId,
    inviteToken: book.inviteToken,
    viewerId: input.viewerId,
    providedInvite: input.invite,
    now: Date.now(),
    paused: false,
  });
  if (!gate.ok) throw new AppError(gate.reason, 403);
  // Past the usage limit, voices are still kept (with the browser's own transcript) but no AI runs.
  const capped = await spendPaused(book.id);
  if (capped && !input.clientTranscript?.trim()) {
    throw new AppError("This book reached its AI usage limit. Try a browser with speech-to-text, or ask the creator to raise the limit.", 429);
  }
  const left = await voicesLeftToday(book.id, input.viewerId);
  if (left <= 0) {
    const limit = book.voiceLimitPerDay;
    throw new AppError(`You've used today's ${limit} ${limit === 1 ? "voice" : "voices"}. 0 left today.`, 429);
  }

  if (input.audio.length < 80 || input.audio.length > MAX_BYTES) {
    throw new AppError("That recording is empty or larger than 32 MB.");
  }
  const durationMs = Math.round(
    input.durationMs || wavDurationMs(input.audio) || 0,
  );
  const maxMs = Math.min(MAX_MS, Math.max(10, book.maxVoiceSeconds || 600) * 1000);
  if (durationMs > maxMs) {
    const seconds = Math.round(maxMs / 1000);
    throw new AppError(
      seconds % 60 === 0
        ? `Keep the recording under ${seconds / 60} ${seconds === 60 ? "minute" : "minutes"}.`
        : `Keep the recording under ${seconds} seconds.`,
    );
  }

  const profile = cleanProfile(input);
  const languageName = languageByCode(challenge.language).name;
  let audio = input.audio;
  let mimeType = input.mimeType;
  try {
    audio = await convertToWavPcm(input.audio);
    mimeType = "audio/wav";
  } catch {
    audio = input.audio;
  }
  const heardInput = {
    audio,
    language: challenge.language,
    startWord: challenge.startWord,
    durationMs: Math.max(durationMs, 0),
    clientTranscript: capped || !(await transcriberLive(book.id)) ? input.clientTranscript : null,
    noAi: capped,
    keywords: [name],
    seed: `${book.id}:${name}:${challenge.id}`,
    bookId: book.id,
  };

  let heard;
  try {
    heard = await transcribeVoice(heardInput);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcription failed.";
    const voice = await storeVoice({
      bookId: book.id,
      name,
      language: challenge.language,
      countryCode: profile.countryCode,
      handle: profile.handle,
      ageBand: profile.ageBand,
      region: profile.region,
      audio,
      mimeType,
      durationMs: Math.max(durationMs, 0),
      startWord: challenge.startWord,
      status: "FAILED",
      userId: input.viewerId,
      guestKey: input.viewerId ? "" : (input.guestKey ?? ""),
      rejectReason: message,
    });
    await consumeChallenge(challenge.id);
    return voice;
  }

  if (heard.audioMs > 0 || heard.usage.inputTokens > 0 || heard.usage.outputTokens > 0) {
    await recordUsage({
      kind: "transcribe",
      provider: heard.provider,
      model: heard.model,
      bookId: book.id,
      audioMs: heard.audioMs,
      usage: heard.usage,
    });
  }

  if (!spokenStartWord(heard.originalText, challenge.startWord)) {
    await consumeChallenge(challenge.id);
    throw new AppError(missingStartWordMessage(challenge.startWord, languageName), 422, "start-word");
  }

  const voice = await storeVoice({
    bookId: book.id,
    name,
    language: challenge.language,
    countryCode: profile.countryCode,
    handle: profile.handle,
    ageBand: profile.ageBand,
    region: profile.region,
    audio,
    mimeType,
    durationMs: heard.durationMs || Math.max(durationMs, 0),
    startWord: challenge.startWord,
    status: "READY",
    originalText: dropStartWord(heard.originalText, challenge.startWord),
    englishText: dropStartWord(heard.englishText, challenge.startWord),
    translated: heard.translated,
    turns: heard.turns,
    startWordPassed: true,
    userId: input.viewerId,
    guestKey: input.viewerId ? "" : (input.guestKey ?? ""),
  });
  await consumeChallenge(challenge.id);
  try {
    return (await settleVoice(voice.id)) ?? voice;
  } catch {
    return voice;
  }
}

export async function retryTranscription(voiceId: string, userId: string, typed?: string | null) {
  const voice = await prisma.voice.findUnique({ include: { book: true }, where: { id: voiceId } });
  if (!voice || voice.book.creatorId !== userId) throw new AppError("That voice is not in your studio.", 404);
  if (voice.status !== "FAILED" || !voice.storageKey) throw new AppError("Only a failed recording can be tried again.");
  const words = typed?.replace(/\s+/g, " ").trim() ?? "";
  if (words) {
    // The creator listened and typed what was said. No AI call, and no start-word check:
    // the creator is the one vouching for it.
    if (words.length > 6000) throw new AppError("Keep the typed words under 6,000 characters.");
    const text = dropStartWord(words, voice.startWord);
    const updated = await prisma.voice.update({
      where: { id: voice.id },
      data: {
        originalText: text,
        englishText: text,
        translated: false,
        turnsJson: JSON.stringify([{ turnId: 0, startMs: 0, endMs: Math.max(voice.durationMs, 1000), transcript: text }] satisfies Turn[]),
        startWordPassed: true,
        status: "READY",
        rejectReason: null,
        decision: "",
      },
    });
    try {
      return (await settleVoice(updated.id)) ?? updated;
    } catch {
      return updated;
    }
  }
  if (await spendPaused(voice.bookId)) throw new AppError("This book reached its AI usage limit. Raise it in Book settings.", 429);
  const audio = await getAudio(voice.storageKey);
  await prisma.voice.update({ where: { id: voice.id }, data: { status: "PROCESSING", rejectReason: null } });
  return finishTranscript(voice.id, {
    audio,
    language: voice.language,
    startWord: voice.startWord,
    durationMs: voice.durationMs,
    clientTranscript: null,
    keywords: [voice.contributorName],
    seed: voice.id,
  });
}

async function finishTranscript(
  voiceId: string,
  input: {
    audio: Buffer;
    language: string;
    startWord: string;
    durationMs: number;
    clientTranscript: string | null;
    keywords: string[];
    seed: string;
  },
) {
  try {
    const owner = await prisma.voice.findUnique({ where: { id: voiceId }, select: { bookId: true } });
    const heard = await transcribeVoice({
      audio: input.audio,
      language: input.language,
      keywords: input.keywords,
      durationMs: input.durationMs,
      clientTranscript: input.clientTranscript,
      seed: input.seed,
      startWord: input.startWord,
      bookId: owner?.bookId,
    });
    const voice = await prisma.voice.findUnique({ where: { id: voiceId } });
    if (heard.audioMs > 0 || heard.usage.inputTokens > 0) {
      await recordUsage({
        kind: "transcribe",
        provider: heard.provider,
        model: heard.model,
        bookId: voice?.bookId,
        voiceId,
        audioMs: heard.audioMs,
        usage: heard.usage,
      });
    }
    if (!spokenStartWord(heard.originalText, input.startWord)) {
      await discardVoice(voiceId);
      throw new AppError(
        missingStartWordMessage(input.startWord, languageByCode(input.language).name),
        422,
        "start-word",
      );
    }
    return prisma.voice.update({
      where: { id: voiceId },
      data: {
        originalText: dropStartWord(heard.originalText, input.startWord),
        englishText: dropStartWord(heard.englishText, input.startWord),
        translated: heard.translated,
        turnsJson: JSON.stringify(heard.turns satisfies Turn[]),
        durationMs: heard.durationMs || input.durationMs,
        startWordPassed: true,
        status: "READY",
        rejectReason: null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcription failed.";
    return prisma.voice.update({
      where: { id: voiceId },
      data: { status: "FAILED", rejectReason: message },
    });
  }
}

export async function addSourcedQuote(input: {
  bookId: string;
  userId: string;
  speaker: string;
  text: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceDate?: string;
  language: string;
}) {
  const book = await prisma.book.findUnique({ where: { id: input.bookId } });
  if (!book || book.creatorId !== input.userId) throw new AppError("That book is not in your studio.", 404);
  const xDate = xPostDate(input.sourceUrl);
  if (book.type !== "FAMOUS" && !xDate) {
    throw new AppError("Only real X reply links can be added to this book. Famous books take any public source.");
  }
  if (xDate && !(input.sourceDate ?? "").trim()) input = { ...input, sourceDate: xDate };
  const check = validateSourcedQuote({ ...input, requireDate: true });
  if (!check.ok) throw new AppError(check.error);
  const language = languageByCode(input.language).code;
  const text = input.text.trim();
  const needs = shouldTranslate(language, text);
  const created = await prisma.voice.create({
    data: {
      bookId: book.id,
      contributorName: input.speaker.trim().slice(0, 80),
      language,
      consentAt: new Date(),
      originalText: text,
      englishText: needs ? text : text,
      translated: false,
      startWordPassed: true,
      status: "READY",
      kind: "sourced_quote",
      sourceUrl: input.sourceUrl.trim(),
      sourceTitle: input.sourceTitle.trim().slice(0, 160),
      sourceDate: (input.sourceDate ?? "").trim().slice(0, 40),
      turnsJson: "[]",
      decision: "approved",
      pipelineStep: "group",
    },
  });
  try {
    return (await settleVoice(created.id)) ?? created;
  } catch {
    return created;
  }
}

export async function setVoiceHidden(voiceId: string, userId: string, hidden: boolean) {
  const voice = await prisma.voice.findUnique({ include: { book: true }, where: { id: voiceId } });
  if (!voice || voice.book.creatorId !== userId) throw new AppError("That voice is not in your studio.", 404);
  return prisma.voice.update({
    where: { id: voiceId },
    data: hidden
      ? { hidden: true, decision: "hidden", status: voice.status === "FAILED" ? "FAILED" : "HIDDEN" }
      : { hidden: false },
  });
}

/** The creator's call on a "needs you" voice: use it in the book. */
export async function approveVoice(voiceId: string, userId: string) {
  const voice = await prisma.voice.findUnique({ include: { book: true }, where: { id: voiceId } });
  if (!voice || voice.book.creatorId !== userId) throw new AppError("That voice is not in your studio.", 404);
  if (!voice.startWordPassed) throw new AppError("This voice never said its start word, so it can't be used.");
  return prisma.voice.update({
    where: { id: voiceId },
    data: { hidden: false, decision: "approved", status: "READY", rejectReason: null },
  });
}

/** The book's owner, or the person who recorded the voice (signed in, or the same browser as a guest), may delete it. */
export async function deleteVoice(voiceId: string, userId: string | null, guestKey: string | null = null) {
  const voice = await prisma.voice.findUnique({ include: { book: { select: { creatorId: true } } }, where: { id: voiceId } });
  if (!voice || !canDeleteVoice(voice, voice.book, userId ? { id: userId } : null, guestKey)) {
    throw new AppError("That voice is not yours.", 404);
  }
  if (voice.storageKey) await deleteAudio(voice.storageKey).catch(() => undefined);
  await prisma.voice.delete({ where: { id: voiceId } });
}

async function storeVoice(input: {
  bookId: string;
  name: string;
  language: string;
  countryCode: string | null;
  handle?: string;
  ageBand?: string;
  region?: string;
  audio: Buffer;
  mimeType: string;
  durationMs: number;
  startWord: string;
  status: string;
  rejectReason?: string | null;
  originalText?: string;
  englishText?: string;
  translated?: boolean;
  turns?: Turn[];
  startWordPassed?: boolean;
  userId?: string | null;
  guestKey?: string;
}) {
  const voiceId = `v_${randomBytes(8).toString("hex")}`;
  const storageKey = `${voiceId}${extensionFor(input.mimeType)}`;
  await putAudio(storageKey, input.audio, input.mimeType || "application/octet-stream");
  return prisma.voice.create({
    data: {
      id: voiceId,
      bookId: input.bookId,
      contributorName: input.name,
      language: input.language,
      countryCode: input.countryCode,
      handle: input.handle ?? "",
      ageBand: input.ageBand ?? "",
      region: input.region ?? "",
      consentAt: new Date(),
      storageKey,
      mimeType: input.mimeType || "application/octet-stream",
      durationMs: input.durationMs,
      startWord: input.startWord,
      status: input.status,
      rejectReason: input.rejectReason ?? null,
      originalText: input.originalText ?? "",
      englishText: input.englishText ?? "",
      translated: input.translated ?? false,
      turnsJson: JSON.stringify(input.turns ?? []),
      startWordPassed: input.startWordPassed ?? false,
      kind: "voice",
      userId: input.userId ?? "",
      guestKey: input.guestKey ?? "",
    },
  });
}

async function consumeChallenge(id: string) {
  await prisma.voiceChallenge.update({ where: { id }, data: { consumedAt: new Date() } });
}

async function discardVoice(voiceId: string) {
  const voice = await prisma.voice.findUnique({ where: { id: voiceId } });
  if (voice?.storageKey) await deleteAudio(voice.storageKey).catch(() => undefined);
  if (voice) await prisma.voice.delete({ where: { id: voiceId } });
}

function cleanProfile(input: { countryCode: string | null; handle: string; ageBand: string; region: string }) {
  const handle = input.handle.trim().replace(/^@/, "");
  if (handle && !/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    throw new AppError("Use an X username with letters, numbers, or underscores.");
  }
  const ageBand = input.ageBand.trim();
  if (ageBand && !(AGE_BANDS as readonly string[]).includes(ageBand)) {
    throw new AppError("Pick an age of 18 or older.");
  }
  return {
    countryCode: countryByCode(input.countryCode)?.code ?? null,
    handle,
    ageBand,
    region: input.region.trim().slice(0, 40),
  };
}

function cleanName(name: string): string {
  const cleaned = name.replace(/[<>]/g, "").trim();
  if (cleaned.length < 1 || cleaned.length > 40) throw new AppError("Use the name you want printed, up to 40 characters.");
  if (/https?:\/\//i.test(cleaned)) throw new AppError("The name cannot be a link.");
  return cleaned;
}

function extensionFor(mime: string): string {
  if (mime.includes("wav")) return ".wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return ".mp3";
  if (mime.includes("mp4") || mime.includes("m4a")) return ".m4a";
  if (mime.includes("ogg")) return ".ogg";
  return ".webm";
}

/** Mock mode only: adds the curated public-domain quotes, clearly labeled as samples. */
export async function addSampleQuotes(bookId: string, userId: string) {
  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book || book.creatorId !== userId) throw new AppError("That book is not in your studio.", 404);
  if (book.type !== "FAMOUS") throw new AppError("Sample quotes are for famous books.");
  if (getConfig().aiMode !== "mock") throw new AppError("Samples are only offered in mock mode. Paste real quotes with their source.");
  const existing = await prisma.voice.findMany({ where: { bookId }, select: { sourceUrl: true } });
  const have = new Set(existing.map((voice) => voice.sourceUrl));
  let added = 0;
  for (const quote of FAMOUS_SAMPLES) {
    if (have.has(quote.url)) continue;
    await addSourcedQuote({
      bookId,
      userId,
      speaker: quote.speaker,
      text: quote.text,
      sourceUrl: quote.url,
      sourceTitle: `${SAMPLE_PREFIX}${quote.title}`,
      sourceDate: quote.date,
      language: "en",
    });
    added += 1;
  }
  return added;
}
