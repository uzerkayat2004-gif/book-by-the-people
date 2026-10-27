import "server-only";
import { randomBytes } from "node:crypto";
import { applyEdits, parseDocument, visibleQuotes } from "../book/assemble";
import { selectRollback, slugify } from "../book/lifecycle";
import type { EditorEdits } from "../book/types";
import { renderReleaseMedia } from "../media/render";
import { notifyReleased } from "../notify";
import { prisma } from "../db";
import { AppError } from "../errors";
import { LANGUAGES } from "../languages";
import { SPEAK_LANGUAGES } from "../speak-languages";
import { canStoreKeys, sealKey } from "../secret-box";
import { parseUsageLimit } from "../ai/spend";

const LANGUAGE_CODES = new Set([...LANGUAGES, ...SPEAK_LANGUAGES].map((language) => language.code));

function clampLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(50, Math.max(1, Math.round(value)));
}

function clampSeconds(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(600, Math.max(15, Math.round(value)));
}

const TYPES = new Set(["SOLO", "INVITED", "OPEN", "FAMOUS"]);
const VIBES = new Set(["ember", "night", "tide", "gold", "paper"]);

const DEFAULT_POLL = [
  "What did a stranger teach you?",
  "What are you afraid to automate?",
  "Who should the next book listen to?",
];

export async function syncClosed(book: { id: string; status: string; closesAt: Date | null }) {
  if (book.status === "COLLECTING" && book.closesAt && book.closesAt.getTime() <= Date.now()) {
    const updated = await prisma.book.update({ where: { id: book.id }, data: { status: "CLOSED" } });
    return { status: updated.status, closesAt: updated.closesAt };
  }
  return { status: book.status, closesAt: book.closesAt };
}

export async function createBook(input: {
  userId: string;
  title: string;
  question: string;
  type: string;
  coverVibe: string;
  closesAt: string | null;
  language?: string;
  voiceLimitPerDay?: number;
  maxVoiceSeconds?: number;
}) {
  const title = input.title.trim();
  const question = input.question.trim();
  if (title.length < 2 || title.length > 80) throw new AppError("Give the book a title.");
  if (question.length < 8 || question.length > 240) throw new AppError("Ask a real question, in one or two sentences.");
  if (!TYPES.has(input.type)) throw new AppError("Pick a book type.");
  const coverVibe = VIBES.has(input.coverVibe) ? input.coverVibe : "ember";

  let closesAt: Date | null = null;
  if (input.closesAt) {
    const parsed = new Date(input.closesAt);
    if (Number.isNaN(parsed.getTime())) throw new AppError("That close time is not a date.");
    if (parsed.getTime() <= Date.now()) throw new AppError("Pick a release time in the future.");
    closesAt = parsed;
  } else if (input.type === "OPEN" || input.type === "INVITED") {
    closesAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }

  let slug = slugify(title);
  const existing = await prisma.book.findUnique({ where: { slug } });
  if (existing) slug = `${slug}-${randomBytes(2).toString("hex")}`;

  const book = await prisma.book.create({
    data: {
      slug,
      title,
      question,
      type: input.type,
      coverVibe,
      closesAt,
      language: input.language && LANGUAGE_CODES.has(input.language) ? input.language : "en",
      voiceLimitPerDay: clampLimit(input.voiceLimitPerDay, input.type === "SOLO" ? 20 : 3),
      maxVoiceSeconds: clampSeconds(input.maxVoiceSeconds, 600),
      creatorId: input.userId,
      inviteToken: randomBytes(16).toString("hex"),
      status: "COLLECTING",
      pollOptions: {
        create: DEFAULT_POLL.map((label, position) => ({ label, position })),
      },
    },
  });
  return book;
}

export async function updateBookSettings(input: {
  bookId: string;
  userId: string;
  title?: string;
  question?: string;
  type?: string;
  coverVibe?: string;
  closesAt?: string | null;
  pollQuestion?: string;
  pollOptions?: string[];
  showPoll?: boolean;
  aiPaused?: boolean;
  bookNumber?: number;
  language?: string;
  voiceLimitPerDay?: number;
  maxVoiceSeconds?: number;
  aiKey?: string;
  clearAiKey?: boolean;
  usageLimit?: { kind: string; value?: number | string | null };
}) {
  const book = await ownedBook(input.bookId, input.userId);
  const data: {
    title?: string;
    question?: string;
    type?: string;
    coverVibe?: string;
    closesAt?: Date | null;
    status?: string;
    pollQuestion?: string;
    showPoll?: boolean;
    aiPaused?: boolean;
    bookNumber?: number;
    language?: string;
    voiceLimitPerDay?: number;
    maxVoiceSeconds?: number;
    aiKeyCipher?: string;
    usageLimitKind?: string;
    usageLimitValue?: number;
  } = {};

  if (input.usageLimit) {
    try {
      const limit = parseUsageLimit(input.usageLimit.kind, input.usageLimit.value ?? 0);
      data.usageLimitKind = limit.kind;
      data.usageLimitValue = limit.value;
    } catch (error) {
      throw new AppError(error instanceof Error ? error.message : "That limit is not valid.");
    }
  }

  if (input.language !== undefined) {
    if (!LANGUAGE_CODES.has(input.language)) throw new AppError("Pick a language from the list.");
    data.language = input.language;
  }
  if (input.voiceLimitPerDay !== undefined) data.voiceLimitPerDay = clampLimit(input.voiceLimitPerDay, book.voiceLimitPerDay);
  if (input.maxVoiceSeconds !== undefined) data.maxVoiceSeconds = clampSeconds(input.maxVoiceSeconds, book.maxVoiceSeconds);
  if (input.clearAiKey) data.aiKeyCipher = "";
  if (input.aiKey !== undefined && input.aiKey.trim()) {
    const key = input.aiKey.trim();
    if (key.length < 12 || /\s/.test(key)) throw new AppError("That doesn't look like an API key.");
    if (!canStoreKeys()) throw new AppError("The server has no AI_KEY_SECRET, so it can't store keys safely yet.", 503);
    data.aiKeyCipher = sealKey(key);
  }

  if (input.title !== undefined) {
    const title = input.title.trim();
    if (title.length < 2) throw new AppError("The title is too short.");
    data.title = title;
  }
  if (input.question !== undefined) {
    const question = input.question.trim();
    if (question.length < 8) throw new AppError("The question is too short.");
    data.question = question;
  }
  if (input.coverVibe && VIBES.has(input.coverVibe)) data.coverVibe = input.coverVibe;
  if (input.type && input.type !== book.type) {
    if (!TYPES.has(input.type)) throw new AppError("Pick a book type.");
    const voices = await prisma.voice.count({ where: { bookId: book.id } });
    if (voices > 0) throw new AppError("The type is locked once someone has contributed.");
    data.type = input.type;
  }
  if (input.closesAt !== undefined) {
    if (!input.closesAt) {
      data.closesAt = null;
      if (book.status === "CLOSED") data.status = "COLLECTING";
    } else {
      const parsed = new Date(input.closesAt);
      if (Number.isNaN(parsed.getTime())) throw new AppError("That close time is not a date.");
      data.closesAt = parsed;
      if (book.status === "CLOSED" && parsed.getTime() > Date.now()) data.status = "COLLECTING";
      if (book.status === "COLLECTING" && parsed.getTime() <= Date.now()) data.status = "CLOSED";
    }
  }
  if (input.pollQuestion !== undefined) {
    const question = input.pollQuestion.trim();
    if (question.length < 4) throw new AppError("Ask something in the poll.");
    data.pollQuestion = question;
  }
  if (input.showPoll !== undefined) data.showPoll = input.showPoll;
  if (input.aiPaused !== undefined) data.aiPaused = input.aiPaused;
  if (input.bookNumber !== undefined && Number.isFinite(input.bookNumber)) {
    data.bookNumber = Math.max(1, Math.round(input.bookNumber));
  }

  if (input.pollOptions) {
    const labels = input.pollOptions.map((label) => label.trim()).filter(Boolean).slice(0, 6);
    if (labels.length < 2) throw new AppError("A poll needs at least two choices.");
    const existing = await prisma.pollOption.findMany({
      where: { bookId: book.id },
      orderBy: { position: "asc" },
    });
    const same =
      existing.length === labels.length && existing.every((option, index) => option.label === labels[index]);
    if (!same) {
      const votes = await prisma.pollVote.count({ where: { bookId: book.id } });
      if (votes > 0) throw new AppError("The poll already has votes, so the choices stay put.");
      await prisma.pollOption.deleteMany({ where: { bookId: book.id } });
      await prisma.pollOption.createMany({
        data: labels.map((label, position) => ({ bookId: book.id, label, position })),
      });
    }
  }

  return prisma.book.update({ where: { id: book.id }, data });
}

export async function closeBook(bookId: string, userId: string) {
  const book = await ownedBook(bookId, userId);
  if (book.status === "PUBLISHED") throw new AppError("This book is already published.");
  return prisma.book.update({
    where: { id: book.id },
    data: { status: "CLOSED", closesAt: new Date() },
  });
}

export async function saveDraftEdits(bookId: string, userId: string, edits: EditorEdits) {
  const book = await ownedBook(bookId, userId);
  if (!book.currentDraftId) throw new AppError("Make the book before editing it.");
  const current = await prisma.bookDraft.findUnique({ where: { id: book.currentDraftId } });
  if (!current) throw new AppError("The current draft is missing.");
  const document = parseDocument(current.contentJson);
  if (!document) throw new AppError("The draft could not be read.");
  const next = applyEdits(document, edits);
  const version = await nextVersion(book.id);
  const draft = await prisma.bookDraft.create({
    data: {
      bookId: book.id,
      version,
      contentJson: JSON.stringify(next),
      provider: document.provider,
      model: document.model,
      note: "Edited by the creator",
    },
  });
  await prisma.book.update({ where: { id: book.id }, data: { currentDraftId: draft.id } });
  return draft;
}

export async function rollbackDraft(bookId: string, userId: string, draftId: string) {
  const book = await ownedBook(bookId, userId);
  const drafts = await prisma.bookDraft.findMany({
    where: { bookId: book.id },
    select: { id: true, version: true },
  });
  const result = selectRollback(drafts, draftId, book.currentDraftId);
  if ("error" in result) throw new AppError(result.error);
  await prisma.book.update({ where: { id: book.id }, data: { currentDraftId: result.nextCurrentId } });
  return { currentDraftId: result.nextCurrentId, kept: drafts.length };
}

export async function publishBook(bookId: string, userId: string) {
  const book = await ownedBook(bookId, userId);
  if (!book.currentDraftId) throw new AppError("Make the book before publishing it.");
  const draft = await prisma.bookDraft.findUnique({ where: { id: book.currentDraftId } });
  const document = draft ? parseDocument(draft.contentJson) : null;
  if (!document || visibleQuotes(document).length === 0) {
    throw new AppError("Publish needs at least one visible quotation.");
  }
  const published = await prisma.book.update({
    where: { id: book.id },
    data: {
      status: "PUBLISHED",
      publishedDraftId: draft!.id,
      publishedAt: book.publishedAt ?? new Date(),
    },
  });
  // Speaking a whole book takes minutes on a laptop, so the audiobook and video are made
  // in the background. The Release tab shows "Making…" until the job is done.
  void makeMediaInBackground(book.id, document!);
  try {
    await notifyReleased(book.id);
  } catch {
    // Email is optional. A missing key or a provider error does not unpublish the book.
  }
  return published;
}

const mediaRuns = new Set<string>();

export async function makeMediaInBackground(bookId: string, document: NonNullable<ReturnType<typeof parseDocument>>, force = false) {
  if (mediaRuns.has(bookId)) return;
  mediaRuns.add(bookId);
  const key = `${bookId}:make:media`;
  await prisma.pipelineJob.upsert({
    where: { key },
    create: { bookId, step: "media", key, status: "running" },
    update: { status: "running", lastError: null },
  });
  try {
    await renderReleaseMedia(bookId, document, { force });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The audiobook could not be made.";
    await prisma.pipelineJob.upsert({
      where: { key },
      create: { bookId, step: "media", key, status: "failed", lastError: message },
      update: { status: "failed", lastError: message, attempts: { increment: 1 } },
    });
  } finally {
    mediaRuns.delete(bookId);
  }
}

export async function votePoll(bookId: string, optionId: string, voterKey: string) {
  const option = await prisma.pollOption.findFirst({ where: { id: optionId, bookId } });
  if (!option) throw new AppError("That choice is not on this poll.");
  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book || book.status !== "PUBLISHED") throw new AppError("The poll opens when the book is published.");
  await prisma.pollVote.upsert({
    where: { bookId_voterKey: { bookId, voterKey } },
    update: { optionId },
    create: { bookId, optionId, voterKey },
  });
}

async function ownedBook(bookId: string, userId: string) {
  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book || book.creatorId !== userId) throw new AppError("That book is not in your studio.", 404);
  return book;
}

async function nextVersion(bookId: string) {
  const max = await prisma.bookDraft.aggregate({ where: { bookId }, _max: { version: true } });
  return (max._max.version ?? 0) + 1;
}

export { ownedBook, nextVersion };
