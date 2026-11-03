import "server-only";
import { writeFeatureBook } from "../ai/feature-writer";
import { assembleBook } from "../book/assemble";
import { canGenerate, statusAfterGenerationFailure } from "../book/lifecycle";
import type { SourceVoice, Turn } from "../book/types";
import { getConfig } from "../config";
import { writerLive } from "../ai/providers";
import { prisma } from "../db";
import { AppError } from "../errors";
import { needsBookLanguage, recordMakeSteps, toBookLanguage } from "./pipeline";
import { languageByCode } from "../languages";
import { spendPaused } from "./spend";
import { nextVersion } from "./books";
import { scrubSecrets } from "../scrub";

export async function generateBook(bookId: string, userId: string, engine: "auto" | "local") {
  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book || book.creatorId !== userId) throw new AppError("That book is not in your studio.", 404);
  if (
    book.status === "GENERATING" &&
    book.generationStartedAt &&
    Date.now() - book.generationStartedAt.getTime() < 3 * 60 * 1000
  ) {
    throw new AppError("A draft is already being written.", 409);
  }

  const rows = await prisma.voice.findMany({
    where: { bookId: book.id, status: "READY", hidden: false },
    orderBy: { createdAt: "asc" },
  });
  const paused = await spendPaused(book.id);
  const live = await writerLive(book.id);
  const gate = canGenerate({
    bookType: book.type,
    status: book.status,
    readyCount: rows.length,
    paused,
    live,
  });
  if (!gate.ok) throw new AppError(gate.reason);

  const previous = book.status;
  await prisma.book.update({
    where: { id: book.id },
    data: { status: "GENERATING", generationStartedAt: new Date(), generationError: null },
  });

  const log: string[] = [];
  try {
    const useLocal = engine === "local" || !live;
    let provider = useLocal ? (engine === "local" && live ? "local" : "mock") : "meta";
    let model = useLocal ? "local-assembly" : getConfig().writerModel;
    const voices = rows.map(toSource);

    if (!useLocal) {
      const target = book.language || "en";
      if (voices.some((voice) => needsBookLanguage({ ...voice, bookLanguage: voice.bookLanguage ?? "" }, target))) {
        log.push(`Putting every voice into ${languageByCode(target).name}.`);
        await toBookLanguage(
          voices.map((voice) => Object.assign(voice, { bookLanguage: voice.bookLanguage ?? "" })),
          target,
          book.id,
        );
      }
      log.push(`Reading all ${voices.length} voices and planning the book.`);
      const written = await writeFeatureBook({
        title: book.title,
        question: book.question,
        bookType: book.type,
        voices,
        bookId: book.id,
        language: book.language || "en",
        log: (line) => log.push(line),
      });
      provider = written.provider;
      model = written.model;
      const document = written;
      log.push(`Saved ${document.chapters.length} ${document.chapters.length === 1 ? "chapter" : "chapters"}.`);
      await recordMakeSteps(book.id);
      return await storeDraft(book.id, previous, document, log);
    }

    log.push(useLocal && engine === "local" ? "Assembling a local draft from the voices on file." : "Demo mode is grouping the voices locally.");
    const document = assembleBook({
      title: book.title,
      question: book.question,
      bookType: book.type,
      voices,
      provider,
      model,
    });
    log.push(`Saved ${document.chapters.length} ${document.chapters.length === 1 ? "chapter" : "chapters"}.`);
    await recordMakeSteps(book.id);
    return await storeDraft(book.id, previous, document, log);
  } catch (error) {
    const message = error instanceof Error ? scrubSecrets(error.message) : "The book could not be written.";
    log.push(message);
    await prisma.book.update({
      where: { id: book.id },
      data: {
        status: statusAfterGenerationFailure(previous),
        generationError: message,
        generationLog: JSON.stringify(log),
      },
    });
    throw new AppError(message, 502);
  }
}

async function storeDraft(
  bookId: string,
  previous: string,
  document: ReturnType<typeof assembleBook>,
  log: string[],
) {
  const version = await nextVersion(bookId);
  const owner = await prisma.book.findUnique({ where: { id: bookId }, select: { language: true } });
  document.language = owner?.language || "en";
  const draft = await prisma.bookDraft.create({
    data: {
      bookId,
      version,
      contentJson: JSON.stringify(document),
      provider: document.provider,
      model: document.model,
      note: log.join(" "),
    },
  });
  const book = await prisma.book.update({
    where: { id: bookId },
    data: {
      status: previous === "PUBLISHED" ? "PUBLISHED" : "REVIEW",
      currentDraftId: draft.id,
      generationError: null,
      generationLog: JSON.stringify(log),
    },
  });
  return { draftId: draft.id, version, log, status: book.status };
}

export function toSource(voice: {
  id: string;
  contributorName: string;
  language: string;
  countryCode: string | null;
  originalText: string;
  englishText: string;
  translated: boolean;
  bookLanguage: string;
  turnsJson: string;
  durationMs: number;
  createdAt: Date;
  kind: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceDate: string;
  hidden: boolean;
  status: string;
  startWord: string;
  storageKey: string | null;
  region?: string;
  checkJson?: string;
}): SourceVoice {
  let check: { notable?: unknown; impersonation?: unknown } = {};
  try {
    check = JSON.parse(voice.checkJson || "{}") as typeof check;
  } catch {
    check = {};
  }
  // Notable only when verified: a sourced public quote with its link, or the creator marked it in Studio.
  const notable = check.notable === true || (voice.kind === "sourced_quote" && Boolean(voice.sourceUrl));
  let turns: Turn[] = [];
  try {
    const parsed = JSON.parse(voice.turnsJson) as Turn[];
    if (Array.isArray(parsed)) turns = parsed;
  } catch {
    turns = [];
  }
  return {
    id: voice.id,
    contributorName: voice.contributorName,
    language: voice.language,
    countryCode: voice.countryCode,
    originalText: voice.originalText,
    englishText: voice.englishText,
    translated: voice.translated,
    bookLanguage: voice.bookLanguage,
    turns,
    durationMs: voice.durationMs,
    createdAt: voice.createdAt.getTime(),
    kind: voice.kind === "sourced_quote" ? "sourced_quote" : "voice",
    sourceUrl: voice.sourceUrl,
    sourceTitle: voice.sourceTitle,
    sourceDate: voice.sourceDate,
    hidden: voice.hidden,
    status: voice.status,
    startWord: voice.startWord,
    hasAudio: Boolean(voice.storageKey),
    region: voice.region ?? "",
    notable,
    nameUnverified: !notable && check.impersonation === true,
  };
}
