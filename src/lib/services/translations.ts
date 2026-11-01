import "server-only";
import { z } from "zod";
import { parseDocument } from "../book/assemble";
import type { BookDocument, Chapter } from "../book/types";
import { completeJson } from "../ai/meta";
import { extractJson } from "../ai";
import { writerLive } from "../ai/providers";
import { getConfig } from "../config";
import { prisma } from "../db";
import { AppError } from "../errors";
import { BOOK_LANGUAGE_CODES, bookLanguage } from "../languages";
import { recordUsage, spendPaused } from "./spend";
import { ownedBook } from "./books";
import { EN, hasBuiltInUi } from "../i18n";
import { scrubSecrets } from "../scrub";

/** A released book can come out in more languages. Each one is a full copy of the book, translated. */
export type TranslationState = { language: string; name: string; status: "waiting" | "working" | "ready" | "failed"; done: number; total: number; error: string };

export function parseLanguages(value: string | null | undefined): string[] {
  return [...new Set((value ?? "").split(",").map((code) => code.trim().toLowerCase()).filter((code) => BOOK_LANGUAGE_CODES.has(code)))];
}

/** Units of work: 1 for the title and preface, then 1 per chapter. */
function totalUnits(document: BookDocument) {
  return 1 + document.chapters.length;
}

export async function translationStates(bookId: string): Promise<TranslationState[]> {
  const book = await prisma.book.findUnique({ where: { id: bookId }, select: { releaseLanguages: true, language: true, publishedDraftId: true } });
  if (!book) return [];
  const wanted = parseLanguages(book.releaseLanguages).filter((code) => code !== (book.language || "en"));
  const rows = await prisma.bookTranslation.findMany({ where: { bookId } });
  const draft = book.publishedDraftId ? await prisma.bookDraft.findUnique({ where: { id: book.publishedDraftId }, select: { contentJson: true } }) : null;
  const document = draft ? parseDocument(draft.contentJson) : null;
  const total = document ? totalUnits(document) : 0;
  return wanted.map((code) => {
    const row = rows.find((item) => item.language === code);
    const current = row && row.draftId === book.publishedDraftId;
    const status: TranslationState["status"] = !document ? "waiting" : !current ? "working" : (row!.status as TranslationState["status"]);
    return { language: code, name: bookLanguage(code).name, status, done: current ? row!.done : 0, total, error: current ? row!.error : "" };
  });
}

/** Languages a reader can switch to right now (the book's own language first). */
export async function readyLanguages(bookId: string): Promise<string[]> {
  const book = await prisma.book.findUnique({ where: { id: bookId }, select: { language: true, publishedDraftId: true, releaseLanguages: true } });
  if (!book?.publishedDraftId) return [];
  const wanted = parseLanguages(book.releaseLanguages);
  const rows = await prisma.bookTranslation.findMany({
    where: { bookId, draftId: book.publishedDraftId, status: "ready" },
    select: { language: true },
  });
  const ready = rows.map((row) => row.language).filter((code) => wanted.includes(code) && code !== (book.language || "en"));
  return ready.length ? [book.language || "en", ...ready] : [];
}

/** The published book in another language, or null when that translation isn't ready. */
export async function translatedDocument(bookId: string, language: string, draftId: string | null): Promise<BookDocument | null> {
  if (!draftId) return null;
  const row = await prisma.bookTranslation.findUnique({ where: { bookId_language: { bookId, language } } });
  if (!row || row.status !== "ready" || row.draftId !== draftId) return null;
  return parseDocument(row.contentJson);
}

export async function setReleaseLanguages(bookId: string, userId: string, codes: string[]) {
  const book = await ownedBook(bookId, userId);
  const clean = parseLanguages(codes.join(",")).filter((code) => code !== (book.language || "en")).slice(0, 12);
  await prisma.book.update({ where: { id: book.id }, data: { releaseLanguages: clean.join(",") } });
  return clean;
}

const headSchema = z.object({ title: z.string(), question: z.string(), preface: z.string() });
const chapterSchema = z.object({
  title: z.string(),
  theme: z.string(),
  narrative: z.string(),
  agreement: z.string().nullable().optional(),
  disagreement: z.string().nullable().optional(),
  quotes: z.array(z.object({ id: z.string(), text: z.string() })),
});
const HEAD_JSON = {
  type: "object",
  additionalProperties: false,
  required: ["title", "question", "preface"],
  properties: { title: { type: "string" }, question: { type: "string" }, preface: { type: "string" } },
};
const CHAPTER_JSON = {
  type: "object",
  additionalProperties: false,
  required: ["title", "theme", "narrative", "agreement", "disagreement", "quotes"],
  properties: {
    title: { type: "string" },
    theme: { type: "string" },
    narrative: { type: "string" },
    agreement: { type: ["string", "null"] },
    disagreement: { type: ["string", "null"] },
    quotes: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["id", "text"], properties: { id: { type: "string" }, text: { type: "string" } } },
    },
  },
};

function system(languageName: string) {
  return [
    `You translate a finished book into ${languageName}.`,
    "Keep the meaning, tone and paragraph breaks. Keep people's names, places and numbers as they are.",
    "Quotes are people's own words: translate them faithfully and plainly, never improve or shorten them.",
    `Write natural ${languageName} for ordinary readers. Return only JSON in the given shape.`,
  ].join(" ");
}

async function ask<T>(bookId: string, languageName: string, schemaName: string, schema: object, payload: unknown, parser: z.ZodType<T>): Promise<T> {
  const result = await completeJson({ system: system(languageName), user: JSON.stringify(payload), schemaName, schema, bookId });
  await recordUsage({ kind: "translate", provider: result.provider, model: result.model, bookId, usage: result.usage });
  return parser.parse(extractJson(result.content));
}

/** Demo mode (no AI key on a local machine): mark the text so the flow can be tried end to end. */
function demo(text: string, code: string) {
  return text ? `[${code}] ${text}` : text;
}

async function translateUnit(bookId: string, code: string, source: BookDocument, target: BookDocument, unit: number, live: boolean) {
  const languageName = bookLanguage(code).name;
  if (unit === 0) {
    const out = live
      ? await ask(bookId, languageName, "book_head", HEAD_JSON, { title: source.title, question: source.question, preface: source.preface }, headSchema)
      : { title: demo(source.title, code), question: demo(source.question, code), preface: demo(source.preface, code) };
    target.title = out.title.trim() || source.title;
    target.question = out.question.trim() || source.question;
    target.preface = out.preface.trim() || source.preface;
    return;
  }
  const chapter: Chapter = source.chapters[unit - 1];
  const payload = {
    title: chapter.title,
    theme: chapter.theme,
    narrative: chapter.narrative,
    agreement: chapter.agreement,
    disagreement: chapter.disagreement,
    quotes: chapter.quotes.map((quote) => ({ id: quote.id, text: quote.englishText || quote.originalText })),
  };
  const out = live
    ? await ask(bookId, languageName, "book_chapter", CHAPTER_JSON, payload, chapterSchema)
    : {
        title: demo(chapter.title, code),
        theme: demo(chapter.theme, code),
        narrative: demo(chapter.narrative, code),
        agreement: chapter.agreement ? demo(chapter.agreement, code) : null,
        disagreement: chapter.disagreement ? demo(chapter.disagreement, code) : null,
        quotes: payload.quotes.map((quote) => ({ id: quote.id, text: demo(quote.text, code) })),
      };
  const byId = new Map(out.quotes.map((quote) => [quote.id, quote.text.trim()]));
  target.chapters[unit - 1] = {
    ...chapter,
    title: out.title.trim() || chapter.title,
    theme: out.theme.trim() || chapter.theme,
    narrative: out.narrative.trim() || chapter.narrative,
    agreement: chapter.agreement ? out.agreement?.trim() || chapter.agreement : null,
    disagreement: chapter.disagreement ? out.disagreement?.trim() || chapter.disagreement : null,
    // The speaker's original words stay in originalText; englishText holds the words as this edition reads them.
    quotes: chapter.quotes.map((quote) => ({ ...quote, englishText: byId.get(quote.id) || quote.englishText })),
  };
}

const running = new Set<string>();

/**
 * Translates the published book into each release language, a few parts per call, and saves as it goes.
 * Safe to call again and again (the Studio does while it shows progress). Stops after `budgetMs`.
 */
export async function advanceTranslations(bookId: string, budgetMs = 40_000, retryFailed = false): Promise<TranslationState[]> {
  const started = Date.now();
  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book) throw new AppError("That book is gone.", 404);
  if (!book.publishedDraftId || running.has(bookId)) return translationStates(bookId);
  const draft = await prisma.bookDraft.findUnique({ where: { id: book.publishedDraftId } });
  const source = draft ? parseDocument(draft.contentJson) : null;
  if (!source) return translationStates(bookId);
  const wanted = parseLanguages(book.releaseLanguages).filter((code) => code !== (book.language || "en"));
  if (!wanted.length) return translationStates(bookId);
  const live = getConfig().aiMode === "live" || (await writerLive(bookId));
  if (await spendPaused(bookId)) throw new AppError("This book reached its AI usage limit. Raise it in Book settings.", 429);
  running.add(bookId);
  try {
    for (const code of wanted) {
      let row = await prisma.bookTranslation.findUnique({ where: { bookId_language: { bookId, language: code } } });
      if (!row || row.draftId !== book.publishedDraftId) {
        const fresh = { ...source, language: code, chapters: source.chapters.map((chapter) => ({ ...chapter })) };
        row = await prisma.bookTranslation.upsert({
          where: { bookId_language: { bookId, language: code } },
          create: { bookId, language: code, draftId: book.publishedDraftId, status: "working", done: 0, contentJson: JSON.stringify(fresh), error: "" },
          update: { draftId: book.publishedDraftId, status: "working", done: 0, contentJson: JSON.stringify(fresh), error: "" },
        });
      }
      if (row.status === "ready") continue;
      // A failed language waits for "Try again" so a broken key isn't called over and over.
      if (row.status === "failed" && !retryFailed) continue;
      const target = parseDocument(row.contentJson) ?? { ...source, language: code };
      target.language = code;
      let done = row.done;
      const total = totalUnits(source);
      while (done < total) {
        if (Date.now() - started > budgetMs) return translationStates(bookId);
        try {
          await translateUnit(bookId, code, source, target, done, live);
        } catch (error) {
          const message = error instanceof Error ? scrubSecrets(error.message).slice(0, 300) : "Translation failed.";
          await prisma.bookTranslation.update({ where: { id: row.id }, data: { status: "failed", error: message, contentJson: JSON.stringify(target), done } });
          return translationStates(bookId);
        }
        done += 1;
        await prisma.bookTranslation.update({
          where: { id: row.id },
          data: { done, contentJson: JSON.stringify(target), status: done >= total ? "ready" : "working", error: "" },
        });
      }
    }
  } finally {
    running.delete(bookId);
  }
  return translationStates(bookId);
}

/**
 * Page words (buttons, headings) for a book language with no built-in dictionary: translated once
 * with the book's AI and kept on the book. Best effort; English shows until it's done.
 */
export async function translateUi(bookId: string): Promise<void> {
  const book = await prisma.book.findUnique({ where: { id: bookId }, select: { language: true, uiJson: true } });
  const code = (book?.language || "en").toLowerCase();
  if (!book || hasBuiltInUi(code)) return;
  try {
    const stored = JSON.parse(book.uiJson || "{}") as { language?: string };
    if (stored.language === code) return;
  } catch {
    // translate again
  }
  if (!(getConfig().aiMode === "live" || (await writerLive(bookId)))) return;
  if (await spendPaused(bookId)) return;
  const keys = Object.keys(EN) as (keyof typeof EN)[];
  const properties = Object.fromEntries(keys.map((key) => [key, { type: "string" }]));
  const languageName = bookLanguage(code).name;
  const result = await completeJson({
    system: [
      `You translate the short interface words of a website into ${languageName}.`,
      "Keep every {placeholder} in curly braces exactly as it is. Keep it short, warm and natural, like a native app.",
      "Return only JSON with the same keys.",
    ].join(" "),
    user: JSON.stringify(EN),
    schemaName: "ui_words",
    schema: { type: "object", additionalProperties: false, required: keys, properties },
    bookId,
  });
  await recordUsage({ kind: "translate", provider: result.provider, model: result.model, bookId, usage: result.usage });
  const parsed = extractJson(result.content) as Record<string, unknown>;
  const strings: Record<string, string> = {};
  for (const key of keys) {
    const value = parsed?.[key];
    const holes = (EN[key].match(/\{\w+\}/g) ?? []).sort().join();
    // Only keep a string when its {holes} survived.
    if (typeof value === "string" && value.trim() && (value.match(/\{\w+\}/g) ?? []).sort().join() === holes) strings[key] = value.trim();
  }
  if (Object.keys(strings).length < keys.length / 2) return;
  await prisma.book.update({ where: { id: bookId }, data: { uiJson: JSON.stringify({ language: code, strings }) } });
}
