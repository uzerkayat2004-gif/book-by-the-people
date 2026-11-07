import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { parseDocument } from "@/lib/book/assemble";
import type { BookDocument } from "@/lib/book/types";
import { chatJson, ProviderError } from "@/lib/ai/provider-client";
import { extractJson } from "@/lib/ai";
import { bookLanguage } from "@/lib/languages";
import { deleteAudio, getAudio, putAudio } from "@/lib/storage";
import { bookSpendPaused, recordUsage } from "@/lib/services/spend";
import { parseLanguages, translatedDocument } from "@/lib/services/translations";
import { isMetaMediaKey, isUploadedKey } from "../render";
import { mp3DurationMs, pcmToMp3, wasmSpeakToWav, wavToMp3 } from "../js-audio";
import { wavDurationMs } from "@/lib/book/speech";
import { mmsFor, voiceOptions } from "./catalog";
import { mediaMetaOnly } from "./flag";
import { MMS_RATE, mmsSpeakTimed, type Cue } from "./mms";
import { NARRATION_SCHEMA, SPOKEN_SCHEMA, applySpoken, featureNarration, isFeatureBook, narrationPrompt, narrationUnits, parseNarration, plainNarration, spokenPrompt, unitSource } from "./narrate";
import { crossfadeJoin, pcmToWav, polishVoice, toFloat, toInt16, wavToPcm, withMusicBed } from "./sound";
import { readScript, readState, writeState, type AudioResult, type MediaState, type Run, type TimedCue, type UnitState } from "./state";
import { safeError, writerOptions, writerTarget } from "./targets";
import type { ChapterScript, Segment } from "./text";

/** Bump when the narrator prompt changes (scripts are made again) or the voice settings change. */
const SCRIPT_V = 4;
const VOICE_V = 4;
/** The final mix (polish, limiter, bitrate). A change re-joins the parts without speaking them again. */
const MIX_V = 2;
const PART_CHARS = 1800;
export const RUNS_PER_DAY = 3;
const LEASE_MS = 240_000;

export const hash = (...parts: (string | number)[]) => createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
const leaseKey = (bookId: string) => `${bookId}:mm:audiobook`;

/** The spoken words for this unit, so a remake picks up cleaned or edited text. */
function unitFingerprint(doc: BookDocument, unit: number): string {
  if (unit === 0) {
    return hash(doc.title ?? "", doc.standfirst ?? "", doc.preface ?? "", doc.outline?.total ?? 0, doc.outline?.countries ?? 0);
  }
  const chapter = doc.chapters[unit - 1];
  if (!chapter) return "";
  return hash(
    chapter.title,
    chapter.narrative,
    ...(chapter.quotes ?? []).filter((quote) => !quote.hidden).map((quote) => `${quote.id}:${quote.englishText}`),
    ...(chapter.blocks ?? []).map((block) => (block.kind === "p" ? block.text : block.kind === "quote" ? block.quoteId : `break:${block.title ?? ""}`)),
  );
}
export { isMetaMediaKey };

/** Cuts a chapter script into parts of about PART_CHARS characters, at segment boundaries. */
export function scriptParts(script: ChapterScript): Segment[][] {
  const parts: Segment[][] = [];
  let current: Segment[] = [];
  let size = 0;
  for (const segment of script.segments) {
    if (current.length && size + segment.text.length > PART_CHARS) {
      parts.push(current);
      current = [];
      size = 0;
    }
    current.push(segment);
    size += segment.text.length;
  }
  if (current.length) parts.push(current);
  return parts;
}

export async function documentsFor(bookId: string) {
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: { id: true, status: true, language: true, releaseLanguages: true, publishedDraftId: true, title: true },
  });
  if (!book || book.status !== "PUBLISHED" || !book.publishedDraftId) throw new AppError("Release the book first, then make its audiobook.");
  const draft = await prisma.bookDraft.findUnique({ where: { id: book.publishedDraftId } });
  const main = draft ? parseDocument(draft.contentJson) : null;
  if (!main) throw new AppError("The released book could not be read.");
  const mainLang = book.language || "en";
  const docs = new Map<string, BookDocument>([[mainLang, main]]);
  const skipped: { lang: string; reason: string }[] = [];
  for (const lang of parseLanguages(book.releaseLanguages)) {
    if (lang === mainLang) continue;
    const doc = await translatedDocument(bookId, lang, book.publishedDraftId);
    if (doc) docs.set(lang, doc);
    else skipped.push({ lang, reason: "Translation not ready yet" });
  }
  return { book, mainLang, docs, skipped, draftId: book.publishedDraftId };
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Without timings (the built-in voice), captions are spread over the part by length. */
function spreadCues(segments: Segment[], ms: number): Cue[] {
  const total = segments.reduce((sum, s) => sum + s.text.length, 0) || 1;
  let at = 0;
  return segments.map((segment, seg) => {
    const length = Math.round((segment.text.length / total) * ms);
    const cue = { seg, startMs: at, endMs: at + length, text: segment.text };
    at += length;
    return cue;
  });
}

/** Starts (or restarts) the audiobook with the saved picks. Work already done with the same inputs is reused. */
export async function startAudiobook(bookId: string): Promise<MediaState> {
  if (await bookSpendPaused(bookId)) throw new AppError("This book reached its usage limit. Raise it in Book settings to make the audiobook.");
  const { book, docs, skipped, draftId } = await documentsFor(bookId);
  const state = await readState(bookId);
  if (state.run?.status === "running") return state;
  const starts = state.starts?.day === today() ? state.starts : { day: today(), count: 0 };
  if (starts.count >= RUNS_PER_DAY) throw new AppError(`You can make the audiobook ${RUNS_PER_DAY} times a day. Try again tomorrow.`);

  const metaOnly = mediaMetaOnly();
  const options = await writerOptions(bookId);
  const pick = state.picks.audiobook.writer;
  const chosen = options.find((o) => o.value === pick && o.usable) ?? options.find((o) => o.recommended);
  const writer = chosen ? { value: chosen.value, label: `${chosen.model} · ${chosen.provider}` } : { value: "", label: "Plain script (no AI model)" };

  const languages: string[] = [];
  const voices: Record<string, string> = {};
  for (const lang of docs.keys()) {
    const choices = voiceOptions(lang, metaOnly);
    const saved = state.picks.audiobook.voices[lang];
    const voice = choices.find((c) => c.id === saved) ?? choices.find((c) => c.recommended);
    if (!voice) {
      skipped.push({ lang, reason: "No Meta voice for this language yet" });
      continue;
    }
    languages.push(lang);
    voices[lang] = voice.id;
  }
  if (!languages.length) throw new AppError("None of this book's languages has a Meta voice yet.");

  const previous = new Map((state.run?.units ?? []).map((u) => [`${u.lang}:${u.unit}`, u]));
  const units: UnitState[] = [];
  for (const lang of languages) {
    const doc = docs.get(lang)!;
    for (let unit = 0; unit < narrationUnits(doc); unit += 1) {
      const scriptHash = hash(draftId, lang, writer.value, unit, SCRIPT_V, unitFingerprint(doc, unit));
      const voiceHash = hash(scriptHash, voices[lang], VOICE_V);
      const old = previous.get(`${lang}:${unit}`);
      const reuseScript = old && old.scriptHash === scriptHash && old.scriptKey;
      const reuseVoice = reuseScript && old.voiceHash === voiceHash && !old.joined && state.run?.status !== "ready" && old.parts && old.partCount && old.parts.length === old.partCount;
      units.push({
        lang,
        unit,
        title: unitSource(doc, unit).title,
        scriptHash,
        scriptKey: reuseScript ? old.scriptKey : undefined,
        plain: reuseScript ? old.plain : undefined,
        note: reuseScript ? old.note : undefined,
        voiceHash,
        parts: reuseVoice ? old.parts : undefined,
        partCount: reuseScript ? old.partCount : undefined,
        tries: 0,
      });
    }
  }
  const run: Run = {
    id: randomUUID(),
    status: "running",
    draftId,
    languages,
    skipped,
    writer,
    voices,
    units,
    startedAt: new Date().toISOString(),
    phase: "Getting ready",
    music: state.picks.audiobook.music !== false,
  };
  // Nothing changed since the last finished audiobook: keep it.
  const allSame = languages.every((lang) => state.audio[lang]?.hash === runHash(run, lang));
  if (allSame) return state;
  state.run = run;
  state.starts = { day: starts.day, count: starts.count + 1 };
  await writeState(bookId, state);
  void book;
  return state;
}

export function runHash(run: Run, lang: string) {
  return hash(...run.units.filter((u) => u.lang === lang).map((u) => u.voiceHash), run.music === false ? "quiet" : "music", MIX_V);
}

export async function takeLease(bookId: string, key = leaseKey(bookId), step = "audiobook"): Promise<boolean> {
  const until = new Date(Date.now() + LEASE_MS);
  await prisma.pipelineJob
    .create({ data: { bookId, step, key, status: "idle", runAfter: new Date(0) } })
    .catch(() => undefined);
  const taken = await prisma.pipelineJob.updateMany({
    where: { key, OR: [{ status: { not: "running" } }, { runAfter: { lt: new Date() } }] },
    data: { status: "running", runAfter: until, attempts: { increment: 1 } },
  });
  return taken.count === 1;
}

export async function dropLease(bookId: string, error: string | null = null, key = leaseKey(bookId)) {
  await prisma.pipelineJob
    .update({ where: { key }, data: { status: error ? "failed" : "idle", runAfter: new Date(), lastError: error } })
    .catch(() => undefined);
}

export const retryable = (error: unknown) =>
  !(error instanceof ProviderError) || error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;

async function makeScript(bookId: string, run: Run, unit: UnitState, doc: BookDocument, deadline: number): Promise<void> {
  const total = narrationUnits(doc);
  let script: ChapterScript | null = null;
  let note: string | undefined;
  const target = run.writer.value ? await writerTarget(bookId, run.writer.value).catch(() => null) : null;
  if (isFeatureBook(doc)) {
    // Feature books: the script follows the book block by block (so the film can follow it too);
    // the script writer only makes each paragraph easier to hear.
    const base = featureNarration(doc, unit.unit);
    script = base;
    unit.plain = !target;
    if (target && base.segments.some((s) => !s.ref?.startsWith("q"))) {
      const room = deadline - Date.now();
      if (room < 25_000) return;
      try {
        const out = await chatJson(target, { ...spokenPrompt({ languageName: bookLanguage(unit.lang).name, bookTitle: doc.title, script: base }), schemaName: "spoken", schema: SPOKEN_SCHEMA, maxTokens: 9000, reasoningEffort: "low", timeoutMs: Math.min(100_000, room - 10_000) });
        await recordUsage({ kind: "media-script", provider: target.tag, model: out.model, bookId, usage: out.usage }).catch(() => undefined);
        script = applySpoken(extractJson(out.content), base);
      } catch (error) {
        unit.plain = true;
        note = safeError(error, target.apiKey);
      }
    }
    unit.note = unit.plain && target ? `Book text read as written: ${note ?? "the model did not answer"}` : undefined;
  } else if (target) {
    const prompt = narrationPrompt({ unit: unit.unit, total, languageName: bookLanguage(unit.lang).name, bookTitle: doc.title, source: unitSource(doc, unit.unit).text });
    for (let attempt = 0; attempt < 3 && !script; attempt += 1) {
      const room = deadline - Date.now();
      // Out of time for this request: leave the unit for the next step rather than settle for the plain script.
      if (room < 25_000) return;
      try {
        const out = await chatJson(target, { ...prompt, schemaName: "narration", schema: NARRATION_SCHEMA, maxTokens: 8000, reasoningEffort: "low", timeoutMs: Math.min(100_000, room - 10_000) });
        await recordUsage({ kind: "media-script", provider: target.tag, model: out.model, bookId, usage: out.usage }).catch(() => undefined);
        script = parseNarration(extractJson(out.content));
      } catch (error) {
        note = safeError(error, target.apiKey);
        if (!retryable(error) && !(error instanceof Error && /narration came back/.test(error.message))) break;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, [2000, 6000][attempt]));
      }
    }
  }
  if (!script) {
    script = plainNarration(doc, unit.unit);
    unit.plain = true;
    unit.note = target ? `Plain script used: ${note ?? "the model did not answer"}` : undefined;
  } else if (!isFeatureBook(doc)) {
    unit.plain = false;
    unit.note = undefined;
  }
  // Chapter names in the player come from the book itself, never from the model.
  script.title = unitSource(doc, unit.unit).title || script.title;
  const key = `book-${bookId}-mm-${unit.lang}-u${unit.unit}-s${unit.scriptHash}.json`;
  await putAudio(key, Buffer.from(JSON.stringify(script)), "application/json");
  unit.scriptKey = key;
  unit.title = script.title;
  unit.partCount = scriptParts(script).length;
  unit.parts = [];
}

async function speakPart(lang: string, voiceId: string, segments: Segment[]): Promise<{ file: Buffer; ext: "mp3" | "wav"; ms: number; cues: Cue[] }> {
  if (voiceId === "espeak") {
    const wav = await wasmSpeakToWav(segments.map((s) => s.text).join(" "));
    const mp3 = await wavToMp3(wav);
    const ms = mp3DurationMs(mp3) || (wavDurationMs(wav) ?? 0);
    return { file: mp3, ext: "mp3", ms, cues: spreadCues(segments, ms) };
  }
  // The Meta voice is kept as raw samples until the end, so the whole book is joined and encoded once.
  const { pcm, cues } = await mmsSpeakTimed(lang, segments);
  return { file: pcmToWav(pcm, MMS_RATE), ext: "wav", ms: Math.round((pcm.length / MMS_RATE) * 1000), cues };
}

async function voicePart(bookId: string, run: Run, unit: UnitState): Promise<void> {
  const script = await readScript(unit.scriptKey!);
  const parts = scriptParts(script);
  unit.partCount = parts.length;
  unit.parts = unit.parts ?? [];
  const index = unit.parts.length;
  const { file, ext, ms, cues } = await speakPart(unit.lang, run.voices[unit.lang], parts[index]);
  const key = `book-${bookId}-mm-${unit.lang}-u${unit.unit}-v${unit.voiceHash}-p${index}.${ext}`;
  await putAudio(key, file, ext === "wav" ? "audio/wav" : "audio/mpeg");
  // Segment numbers in the cues count from the start of the chapter, not the part.
  const before = parts.slice(0, index).reduce((sum, part) => sum + part.length, 0);
  unit.parts.push({ key, ms, cues: cues.map((cue) => ({ ...cue, seg: cue.seg + before })) });
}

async function join(bookId: string, state: MediaState, run: Run, lang: string): Promise<void> {
  const units = run.units.filter((u) => u.lang === lang).sort((a, b) => a.unit - b.unit);
  const files: Buffer[] = [];
  const chapters: { title: string; startMs: number }[] = [];
  const cues: TimedCue[] = [];
  const unitTimes: AudioResult["units"] = [];
  const allParts = units.flatMap((u) => u.parts ?? []);
  // Pieces of an older, finished run may already be gone: record those chapters again.
  const missing: UnitState[] = [];
  const pieces = new Map<string, Buffer>();
  for (const unit of units) {
    for (const part of unit.parts ?? []) {
      const bytes = await getAudio(part.key).catch(() => null);
      if (bytes) pieces.set(part.key, bytes);
      else {
        missing.push(unit);
        break;
      }
    }
  }
  if (missing.length) {
    for (const unit of missing) {
      unit.parts = undefined;
      unit.joined = false;
    }
    return;
  }
  const raw = allParts.length > 0 && allParts.every((p) => p.key.endsWith(".wav"));
  const music = raw && run.music !== false;
  let at = 0;
  for (const unit of units) {
    chapters.push({ title: unit.title, startMs: at });
    const unitStart = at;
    for (const part of unit.parts ?? []) {
      files.push(pieces.get(part.key)!);
      for (const cue of part.cues ?? []) cues.push({ unit: unit.unit, seg: cue.seg, startMs: at + cue.startMs, endMs: at + cue.endMs, text: cue.text });
      at += part.ms;
    }
    unitTimes!.push({ unit: unit.unit, startMs: unitStart, ms: at - unitStart, scriptKey: unit.scriptKey ?? "" });
  }
  let audio: Buffer;
  if (raw) {
    // One voice, one loudness, joined with tiny crossfades and encoded once: no seams between parts.
    let voice = polishVoice(crossfadeJoin(files.map((file) => toFloat(wavToPcm(file))), MMS_RATE, 20), MMS_RATE);
    let offset = 0;
    if (music) {
      const bed = withMusicBed(voice, MMS_RATE);
      voice = bed.audio;
      offset = bed.offsetMs;
    }
    audio = await pcmToMp3(toInt16(voice), MMS_RATE, 64);
    const total = Math.round((voice.length / MMS_RATE) * 1000);
    // Everything moves later by the music's lead-in, and 20 ms earlier at each crossfade between parts.
    let delta = offset;
    let cueAt = 0;
    let first = true;
    units.forEach((unit, index) => {
      if (index > 0) {
        chapters[index].startMs += delta - (unit.parts?.length ? 20 : 0);
        unitTimes![index].startMs = chapters[index].startMs;
      }
      for (const part of unit.parts ?? []) {
        if (!first) delta -= 20;
        first = false;
        for (let k = 0; k < (part.cues?.length ?? 0); k += 1) {
          cues[cueAt + k].startMs += delta;
          cues[cueAt + k].endMs += delta;
        }
        cueAt += part.cues?.length ?? 0;
      }
    });
    for (let i = 0; i < unitTimes!.length; i += 1) unitTimes![i].ms = (i + 1 < unitTimes!.length ? unitTimes![i + 1].startMs : total) - unitTimes![i].startMs;
    at = total;
  } else audio = Buffer.concat(files);
  const runKey = runHash(run, lang);
  const key = `book-${bookId}-mm-audiobook-${lang}-${runKey}.mp3`;
  await putAudio(key, audio, "audio/mpeg");
  const cuesKey = `book-${bookId}-mm-audiobook-${lang}-${runKey}-cues.json`;
  await putAudio(cuesKey, Buffer.from(JSON.stringify(cues)), "application/json");
  const old = state.audio[lang];
  const result: AudioResult = {
    key,
    bytes: audio.length,
    ms: at,
    chapters,
    writer: run.writer.label,
    voice: voiceOptions(lang, false).find((v) => v.id === run.voices[lang])?.label ?? run.voices[lang],
    music,
    plainUnits: units.filter((u) => u.plain).length,
    madeAt: new Date().toISOString(),
    hash: runKey,
    scriptsHash: hash(...units.map((u) => u.scriptHash)),
    cuesKey,
    units: unitTimes,
  };
  state.audio[lang] = result;
  const book = await prisma.book.findUnique({ where: { id: bookId }, select: { language: true, audiobookKey: true } });
  if (book && lang === (book.language || "en") && !isUploadedKey(book.audiobookKey)) {
    const replaced = book.audiobookKey;
    await prisma.book.update({ where: { id: bookId }, data: { audiobookKey: key, audiobookBytes: audio.length, audiobookName: "" } });
    if (replaced && replaced !== key && isMetaMediaKey(replaced)) await deleteAudio(replaced).catch(() => undefined);
  } else if (old && old.key !== key) {
    await deleteAudio(old.key).catch(() => undefined);
  }
  if (old?.cuesKey && old.cuesKey !== cuesKey) await deleteAudio(old.cuesKey).catch(() => undefined);
  // The joined file holds everything; the pieces are not needed any more.
  for (const unit of units) {
    unit.joined = true;
    for (const part of unit.parts ?? []) await deleteAudio(part.key).catch(() => undefined);
  }
}

export type AudiobookProgress = {
  status: "none" | "running" | "ready" | "failed" | "busy";
  phase: string;
  percent: number;
  scripts: { done: number; total: number };
  voice: { done: number; total: number };
  plainUnits: number;
  error?: string;
  skipped: { lang: string; reason: string }[];
};

export function progressOf(state: MediaState, busy = false): AudiobookProgress {
  const run = state.run;
  if (!run) return { status: "none", phase: "", percent: 0, scripts: { done: 0, total: 0 }, voice: { done: 0, total: 0 }, plainUnits: 0, skipped: [] };
  const scriptsDone = run.units.filter((u) => u.scriptKey).length;
  const partsTotal = run.units.reduce((sum, u) => sum + (u.partCount ?? 2), 0);
  const partsDone = run.units.reduce((sum, u) => sum + (u.parts?.length ?? 0), 0);
  const joined = run.languages.filter((lang) => state.audio[lang]?.hash === runHash(run, lang)).length;
  const percent = run.status === "ready" ? 100 : Math.min(99, Math.round(((scriptsDone / run.units.length) * 30 + (partsDone / Math.max(1, partsTotal)) * 62 + (joined / run.languages.length) * 8)));
  return {
    status: busy && run.status === "running" ? "busy" : run.status,
    phase: run.phase,
    percent,
    scripts: { done: scriptsDone, total: run.units.length },
    voice: { done: partsDone, total: partsTotal },
    plainUnits: run.units.filter((u) => u.plain).length,
    error: run.error,
    skipped: run.skipped,
  };
}

/**
 * Does the next bit of work, for about `budgetMs`, then saves. Studio calls this again and again;
 * a closed tab just pauses the work, and the next call carries on.
 */
export async function advanceAudiobook(bookId: string, budgetMs = 150_000): Promise<AudiobookProgress> {
  const started = Date.now();
  let state = await readState(bookId);
  if (state.run?.status !== "running") return progressOf(state);
  if (!(await takeLease(bookId))) return progressOf(state, true);
  // Read again under the lease, in case another step just saved.
  state = await readState(bookId);
  const run = state.run;
  if (!run || run.status !== "running") {
    await dropLease(bookId);
    return progressOf(state);
  }
  const left = () => budgetMs - (Date.now() - started);
  try {
    const { docs } = await documentsFor(bookId);
    // 1. Scripts, four at a time.
    const needScript = run.units.filter((u) => !u.scriptKey);
    if (needScript.length) {
      run.phase = run.writer.value ? `Writing the narration with ${run.writer.label.split(" · ")[0]}` : "Preparing the narration";
      for (let i = 0; i < needScript.length && left() > 60_000; i += 4) {
        await Promise.all(
          needScript.slice(i, i + 4).map(async (unit) => {
            const doc = docs.get(unit.lang);
            if (!doc) throw new AppError("The book changed while the audiobook was being made. Press Make again.");
            await makeScript(bookId, run, unit, doc, started + budgetMs);
          }),
        );
        await writeState(bookId, state);
      }
    }
    // 2. Voice, one part at a time.
    if (run.units.every((u) => u.scriptKey)) {
      for (const unit of run.units) {
        while ((unit.parts?.length ?? 0) < (unit.partCount ?? 1) && left() > 45_000) {
          run.phase = `Recording with ${mmsFor(unit.lang) && run.voices[unit.lang] !== "espeak" ? "the Meta voice" : "the built-in voice"} (${bookLanguage(unit.lang).name})`;
          try {
            await voicePart(bookId, run, unit);
            unit.tries = 0;
          } catch (error) {
            unit.tries += 1;
            if (unit.tries >= 3) throw new AppError(`The voice failed on "${unit.title}": ${safeError(error)}`);
          }
          await writeState(bookId, state);
        }
        if ((unit.parts?.length ?? 0) < (unit.partCount ?? 1)) break;
      }
    }
    // 3. Join each finished language.
    const voiced = (lang: string) => run.units.filter((u) => u.lang === lang).every((u) => u.scriptKey && u.partCount && u.parts?.length === u.partCount);
    for (const lang of run.languages) {
      if (state.audio[lang]?.hash === runHash(run, lang) || !voiced(lang) || left() < 20_000) continue;
      run.phase = "Putting the chapters together";
      await join(bookId, state, run, lang);
      await writeState(bookId, state);
    }
    if (run.languages.every((lang) => state.audio[lang]?.hash === runHash(run, lang))) {
      run.status = "ready";
      run.phase = "Ready";
      run.finishedAt = new Date().toISOString();
      await writeState(bookId, state);
    }
    await dropLease(bookId);
  } catch (error) {
    run.status = "failed";
    run.error = safeError(error);
    run.phase = "Stopped";
    await writeState(bookId, state).catch(() => undefined);
    await dropLease(bookId, run.error);
  }
  return progressOf(state);
}

export async function savePicks(bookId: string, picks: { writer?: string; voices?: Record<string, string>; music?: boolean }): Promise<MediaState> {
  const state = await readState(bookId);
  if (typeof picks.music === "boolean") state.picks.audiobook.music = picks.music;
  if (typeof picks.writer === "string") state.picks.audiobook.writer = picks.writer.slice(0, 200);
  if (picks.voices) {
    for (const [lang, voice] of Object.entries(picks.voices)) {
      if (/^[a-z]{2,3}$/.test(lang) && typeof voice === "string") state.picks.audiobook.voices[lang] = voice.slice(0, 40);
    }
  }
  await writeState(bookId, state);
  return state;
}

/** For Studio: the pickers, what is saved, and how the last run went. */
export async function audiobookPanel(bookId: string) {
  const state = await readState(bookId);
  const { docs, skipped } = await documentsFor(bookId).catch(() => ({ docs: new Map<string, BookDocument>(), skipped: [] as { lang: string; reason: string }[] }));
  const metaOnly = mediaMetaOnly();
  const writers = await writerOptions(bookId);
  // Before release there is no book text yet: show the voice pickers for the languages it will be released in.
  let langs = [...docs.keys()];
  if (!langs.length) {
    const book = await prisma.book.findUnique({ where: { id: bookId }, select: { language: true, releaseLanguages: true } });
    if (book) langs = [...new Set([book.language || "en", ...parseLanguages(book.releaseLanguages)])];
  }
  const languages = langs.map((lang) => ({
    lang,
    name: bookLanguage(lang).name,
    voices: voiceOptions(lang, metaOnly),
    picked: state.picks.audiobook.voices[lang] ?? "",
  }));
  const units = [...docs.values()].reduce((sum, doc) => sum + narrationUnits(doc), 0);
  const words = [...docs.values()].reduce((sum, doc) => sum + JSON.stringify(doc).split(/\s+/).length, 0);
  return {
    metaOnly,
    writers,
    writerPicked: state.picks.audiobook.writer,
    music: state.picks.audiobook.music !== false,
    languages,
    waiting: skipped,
    progress: progressOf(state),
    audio: state.audio,
    estimate: { units, minutes: Math.round(words / 150), usd: Math.round((((words * 1.4 + units * 350) * 1.25 + (words * 1.6 + units * 1300) * 4.25) / 1e6) * 100) / 100 },
    runsLeftToday: RUNS_PER_DAY - (state.starts?.day === today() ? state.starts.count : 0),
  };
}

export async function audiobookFor(bookId: string, lang: string): Promise<AudioResult | null> {
  const state = await readState(bookId);
  return state.audio[lang] ?? null;
}

/** The Meta audiobook tracks readers can play, the page's language first. Empty unless the Meta audiobook is the book's audio. */
export async function readerTracks(
  book: { id: string; slug: string; language: string; audiobookKey: string | null },
  pageLang: string,
): Promise<{ tracks: { lang: string; name: string; src: string; downloadHref: string; bytes: number; chapters: { title: string; startMs: number }[] }[]; credit: string }> {
  if (!isMetaMediaKey(book.audiobookKey)) return { tracks: [], credit: "" };
  const state = await readState(book.id).catch(() => null);
  if (!state) return { tracks: [], credit: "" };
  const main = book.language || "en";
  const tracks = Object.entries(state.audio)
    .filter(([lang, audio]) => (lang === main ? audio.key === book.audiobookKey : true))
    .map(([lang, audio]) => {
      const query = lang === main ? "" : `lang=${lang}&`;
      return {
        lang,
        name: bookLanguage(lang).name,
        src: `/api/media/${book.slug}/audiobook?${query}v=${audio.bytes}`,
        downloadHref: `/api/media/${book.slug}/audiobook?${query}download=1`,
        bytes: audio.bytes,
        chapters: audio.chapters,
      };
    })
    .sort((a, b) => (a.lang === pageLang ? -1 : b.lang === pageLang ? 1 : a.lang === main ? -1 : b.lang === main ? 1 : 0));
  const first = state.audio[tracks[0]?.lang ?? main];
  const writer = first?.writer.split(" · ")[0] ?? "";
  const credit = first ? `Narration${writer && !/plain/i.test(writer) ? ` written by ${writer}` : ""} · Voice: ${first.voice.split(" · ")[0]}` : "";
  return { tracks, credit };
}
