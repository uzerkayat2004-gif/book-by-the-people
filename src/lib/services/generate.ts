import "server-only";
import { writeBook, translateBatch } from "../ai";
import { assembleBook, repairModelBook } from "../book/assemble";
import { canGenerate, statusAfterGenerationFailure } from "../book/lifecycle";
import { shouldTranslate } from "../book/speech";
import type { SourceVoice, Turn } from "../book/types";
import { getConfig } from "../config";
import { prisma } from "../db";
import { AppError } from "../errors";
import { recordMakeSteps } from "./pipeline";
import { recordUsage, spendPaused } from "./spend";
import { nextVersion } from "./books";

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
  const live = getConfig().aiMode === "live";
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
      const pending = voices.filter((voice) => shouldTranslate(voice.language, voice.originalText) && !voice.translated);
      if (pending.length > 0) {
        log.push("Translating voices that are not already English.");
        const translated = await translateBatch(
          pending.map((voice) => ({ id: voice.id, language: voice.language, text: voice.originalText })),
          book.id,
        );
        await recordUsage({
          kind: "translate",
          provider: translated.provider,
          model: translated.model,
          bookId: book.id,
          usage: translated.usage,
        });
        const english = new Map(translated.translations.map((item) => [item.id, item.english]));
        for (const voice of voices) {
          const next = english.get(voice.id);
          if (!next) continue;
          voice.englishText = next;
          voice.translated = next.trim() !== voice.originalText.trim();
          await prisma.voice.update({
            where: { id: voice.id },
            data: { englishText: voice.englishText, translated: voice.translated },
          });
        }
      }
      log.push("Asking the writing model to group the voices and keep their words.");
      const written = await writeBook({
        title: book.title,
        question: book.question,
        bookType: book.type,
        voices,
        bookId: book.id,
      });
      await recordUsage({
        kind: "compose",
        provider: written.provider,
        model: written.modelId,
        bookId: book.id,
        usage: written.usage,
      });
      provider = written.provider;
      model = written.modelId;
      const document = repairModelBook({
        title: book.title,
        question: book.question,
        bookType: book.type,
        voices,
        model: written.model,
        provider,
        modelId: model,
      });
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
    const message = error instanceof Error ? error.message : "The book could not be written.";
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

function toSource(voice: {
  id: string;
  contributorName: string;
  language: string;
  countryCode: string | null;
  originalText: string;
  englishText: string;
  translated: boolean;
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
}): SourceVoice {
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
  };
}
