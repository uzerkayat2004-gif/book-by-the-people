import "server-only";
import { mergeModelReview, reviewVoice, type Decision } from "../book/checks";
import { shouldTranslate } from "../book/speech";
import { prisma } from "../db";
import { reviewWithModel, translateBatch } from "../ai";
import { writerLive } from "../ai/providers";
import { bookSpendPaused, recordUsage } from "./spend";
import { scrubSecrets } from "../scrub";

const VOICE_STEPS = ["transcribe", "translate", "checks", "decide", "group"] as const;

const STATUS: Record<Decision, { status: string; hidden: boolean }> = {
  approved: { status: "READY", hidden: false },
  needs_you: { status: "NEEDS_YOU", hidden: false },
  not_used: { status: "NOT_USED", hidden: false },
  hidden: { status: "HIDDEN", hidden: true },
};

async function upsertJob(bookId: string, voiceId: string | null, step: string) {
  const key = voiceId ? `${voiceId}:${step}` : `${bookId}:make:${step}`;
  return prisma.pipelineJob.upsert({
    where: { key },
    create: { bookId, voiceId, step, key, status: "pending" },
    update: {},
  });
}

export async function recordMakeSteps(bookId: string) {
  for (const step of ["outline", "titles", "prose", "front"]) {
    const key = `${bookId}:make:${step}`;
    await prisma.pipelineJob.upsert({
      where: { key },
      create: { bookId, step, key, status: "done" },
      update: { status: "done", lastError: null },
    });
  }
}

/** Voices this person can still add today: by account when signed in, else by this browser's guest key. */
export async function voicesLeftToday(bookId: string, userId: string | null, guestKey?: string | null) {
  const book = await prisma.book.findUnique({ where: { id: bookId }, select: { voiceLimitPerDay: true } });
  const limit = book?.voiceLimitPerDay ?? 3;
  if (!userId && !guestKey) return limit;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const used = await prisma.voice.count({
    where: userId
      ? { bookId, userId, kind: "voice", createdAt: { gte: since } }
      : { bookId, userId: "", guestKey: guestKey ?? "", kind: "voice", createdAt: { gte: since } },
  });
  return Math.max(0, limit - used);
}

/** Guest voices from one network in a day: per book, and across the whole site. Signed-in people are not counted. */
export const GUEST_NETWORK_LIMITS = { perBook: 20, perSite: 60 };

export async function guestNetworkFull(bookId: string, ipHash: string): Promise<boolean> {
  if (!ipHash || process.env.NODE_ENV !== "production") return false;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [book, site] = await Promise.all([
    prisma.voice.count({ where: { bookId, ipHash, userId: "", createdAt: { gte: since } } }),
    prisma.voice.count({ where: { ipHash, userId: "", createdAt: { gte: since } } }),
  ]);
  return book >= GUEST_NETWORK_LIMITS.perBook || site >= GUEST_NETWORK_LIMITS.perSite;
}

export async function settleVoice(voiceId: string) {
  const voice = await prisma.voice.findUnique({ where: { id: voiceId }, include: { book: true } });
  if (!voice) return null;
  if (voice.book.aiPaused) {
    await prisma.voice.update({ where: { id: voice.id }, data: { pipelineStep: "waiting", status: voice.originalText ? "PROCESSING" : voice.status } });
    return prisma.voice.findUnique({ where: { id: voiceId } });
  }
  if (await bookSpendPaused(voice.bookId)) {
    await prisma.voice.update({
      where: { id: voice.id },
      data: { pipelineStep: "paused", rejectReason: "Usage limit reached." },
    });
    return prisma.voice.findUnique({ where: { id: voiceId } });
  }

  for (const step of VOICE_STEPS) {
    const job = await upsertJob(voice.bookId, voice.id, step);
    if (job.status === "done") continue;
    if (job.status === "failed" && job.runAfter.getTime() > Date.now()) break;
    try {
      await runStep(step, voice.id);
      await prisma.pipelineJob.update({ where: { id: job.id }, data: { status: "done", lastError: null } });
    } catch (error) {
      const attempts = job.attempts + 1;
      await prisma.pipelineJob.update({
        where: { id: job.id },
        data: {
          status: attempts >= 4 ? "failed" : "pending",
          attempts,
          lastError: error instanceof Error ? scrubSecrets(error.message) : "This step failed.",
          runAfter: new Date(Date.now() + attempts * attempts * 15_000),
        },
      });
      break;
    }
  }
  return prisma.voice.findUnique({ where: { id: voiceId } });
}

async function runStep(step: (typeof VOICE_STEPS)[number], voiceId: string) {
  const voice = await prisma.voice.findUnique({ where: { id: voiceId }, include: { book: true } });
  if (!voice) return;
  if (step === "transcribe") {
    await prisma.voice.update({ where: { id: voice.id }, data: { pipelineStep: "transcribe" } });
    return;
  }
  if (step === "translate") {
    if (voice.kind !== "sourced_quote") await toBookLanguage([voice], voice.book.language || "en", voice.bookId);
    await prisma.voice.update({ where: { id: voice.id }, data: { pipelineStep: "translate" } });
    return;
  }

  const fresh = await prisma.voice.findUnique({ where: { id: voiceId }, include: { book: true } });
  if (!fresh) return;
  const others = await prisma.voice.findMany({
    where: { bookId: fresh.bookId, id: { not: fresh.id } },
    select: { id: true, englishText: true, originalText: true },
  });
  const review = reviewVoice({
    id: fresh.id,
    question: fresh.book.question,
    text: fresh.englishText || fresh.originalText,
    name: fresh.contributorName,
    startWordPassed: fresh.startWordPassed,
    kind: fresh.kind === "sourced_quote" ? "sourced_quote" : "voice",
    sourceUrl: fresh.sourceUrl,
    others: others.map((other) => ({ id: other.id, text: other.englishText || other.originalText })),
  });

  if (step === "checks") {
    let checked = review;
    if ((await writerLive(fresh.bookId)) && review.realPerson && !review.copyPaste && !review.duplicate) {
      const kind = fresh.kind === "sourced_quote" ? "sourced_quote" : "voice";
      const judged = await reviewWithModel({
        bookId: fresh.bookId,
        question: fresh.book.question,
        name: fresh.contributorName,
        text: fresh.englishText || fresh.originalText,
        kind,
      });
      await recordUsage({
        kind: "check",
        provider: judged.provider,
        model: judged.model,
        bookId: fresh.bookId,
        voiceId: fresh.id,
        usage: judged.usage,
      });
      checked = mergeModelReview(review, judged.review, kind);
    }
    await prisma.voice.update({
      where: { id: fresh.id },
      data: { checkJson: JSON.stringify(checked), pipelineStep: "checks" },
    });
    return;
  }
  const stored = (() => {
    try {
      const parsed = JSON.parse(fresh.checkJson || "{}") as Partial<typeof review>;
      return parsed.decision ? { ...review, ...parsed } : review;
    } catch {
      return review;
    }
  })();
  if (step === "decide") {
    const mapped = STATUS[stored.decision];
    await prisma.voice.update({
      where: { id: fresh.id },
      data: {
        decision: stored.decision,
        status: fresh.kind === "sourced_quote" && stored.decision === "approved" ? "READY" : mapped.status,
        hidden: mapped.hidden || fresh.hidden,
        rejectReason: stored.notes[0] ?? null,
        pipelineStep: "decide",
      },
    });
    return;
  }
  await prisma.voice.update({
    where: { id: fresh.id },
    data: { themeLabel: stored.theme, pipelineStep: "group" },
  });
}

/**
 * Voices left out by the old, stricter rules ("off the question" or "too close to another voice")
 * are brought back: kept in the book when no AI checks this book, otherwise put in front of the creator.
 * Exact copies stay out.
 */
export async function reopenSoftRefusals(bookId: string) {
  const soft = await prisma.voice.findMany({
    where: { bookId, status: "NOT_USED", rejectReason: { in: ["Off the question.", "Too close to another voice."] } },
    select: { id: true },
  });
  if (!soft.length) return 0;
  const live = await writerLive(bookId).catch(() => false);
  await prisma.voice.updateMany({
    where: { id: { in: soft.map((voice) => voice.id) } },
    data: live
      ? { status: "NEEDS_YOU", decision: "needs_you", hidden: false }
      : { status: "READY", decision: "approved", hidden: false, rejectReason: null },
  });
  return soft.length;
}

export async function tickBook(bookId: string) {
  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book) return { processed: 0, paused: false };
  await reopenSoftRefusals(bookId).catch(() => 0);
  if (book.aiPaused) return { processed: 0, paused: true };
  const waiting = await prisma.voice.findMany({
    where: {
      bookId,
      OR: [{ decision: "" }, { pipelineStep: "waiting" }, { status: "PROCESSING" }, { status: "FAILED" }],
    },
    orderBy: { createdAt: "asc" },
    take: 8,
    select: { id: true },
  });
  for (const voice of waiting) await settleVoice(voice.id);
  const due = await prisma.pipelineJob.findMany({
    where: { bookId, status: "pending", runAfter: { lte: new Date() }, voiceId: { not: null } },
    take: 8,
  });
  const seen = new Set(waiting.map((voice) => voice.id));
  for (const job of due) {
    if (!job.voiceId || seen.has(job.voiceId)) continue;
    seen.add(job.voiceId);
    await settleVoice(job.voiceId);
  }
  return { processed: seen.size, paused: false };
}

type Translatable = {
  id: string;
  language: string;
  originalText: string;
  englishText: string;
  translated: boolean;
  bookLanguage: string;
};

/** Whether this voice's book-language text is missing or in another language than the book's. */
export function needsBookLanguage(voice: Translatable, target: string): boolean {
  if (!voice.originalText.trim()) return false;
  if ((voice.bookLanguage || "en") !== target) return true;
  if (!voice.englishText.trim()) return true;
  return shouldTranslate(voice.language, voice.originalText, target) && !voice.translated;
}

/**
 * Puts each voice's words into the book's main language (stored in englishText, with bookLanguage).
 * The original words are never touched. If the AI fails this throws and the job retries later;
 * the voice keeps its original words meanwhile.
 */
export async function toBookLanguage<T extends Translatable>(voices: T[], target: string, bookId: string): Promise<T[]> {
  const pending = voices.filter((voice) => needsBookLanguage(voice, target));
  const same = pending.filter((voice) => !shouldTranslate(voice.language, voice.originalText, target));
  for (const voice of same) {
    voice.englishText = voice.originalText;
    voice.translated = false;
    voice.bookLanguage = target;
    await prisma.voice.update({ where: { id: voice.id }, data: { englishText: voice.englishText, translated: false, bookLanguage: target } });
  }
  const other = pending.filter((voice) => !same.includes(voice));
  // A few at a time keeps each AI call small and fast.
  for (let start = 0; start < other.length; start += 8) {
    const batch = other.slice(start, start + 8);
    const result = await translateBatch(
      batch.map((voice) => ({ id: voice.id, language: voice.language, text: voice.originalText })),
      bookId,
      target,
    );
    await recordUsage({ kind: "translate", provider: result.provider, model: result.model, bookId, usage: result.usage });
    for (const voice of batch) {
      const out = result.translations.find((item) => item.id === voice.id);
      if (!out || !out.done) continue;
      voice.englishText = out.english;
      voice.translated = out.english.trim() !== voice.originalText.trim();
      voice.bookLanguage = target;
      await prisma.voice.update({
        where: { id: voice.id },
        data: { englishText: voice.englishText, translated: voice.translated, bookLanguage: target },
      });
    }
  }
  return voices;
}
