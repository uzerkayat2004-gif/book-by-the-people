import "server-only";
import { mergeModelReview, reviewVoice, type Decision } from "../book/checks";
import { getConfig } from "../config";
import { shouldTranslate } from "../book/speech";
import { prisma } from "../db";
import { reviewWithModel, translateBatch } from "../ai";
import { bookSpendPaused, recordUsage } from "./spend";

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

export async function voicesLeftToday(bookId: string, userId: string | null) {
  const book = await prisma.book.findUnique({ where: { id: bookId }, select: { voiceLimitPerDay: true } });
  const limit = book?.voiceLimitPerDay ?? 3;
  if (!userId) return limit;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const used = await prisma.voice.count({
    where: { bookId, userId, kind: "voice", createdAt: { gte: since } },
  });
  return Math.max(0, limit - used);
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
      data: { pipelineStep: "paused", rejectReason: "This book's spend cap is reached." },
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
          lastError: error instanceof Error ? error.message : "This step failed.",
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
    if (voice.kind === "sourced_quote" || !shouldTranslate(voice.language, voice.originalText) || voice.translated) {
      await prisma.voice.update({ where: { id: voice.id }, data: { pipelineStep: "translate" } });
      return;
    }
    const translated = await translateBatch(
      [{ id: voice.id, language: voice.language, text: voice.originalText }],
      voice.bookId,
    );
    await recordUsage({
      kind: "translate",
      provider: translated.provider,
      model: translated.model,
      bookId: voice.bookId,
      voiceId: voice.id,
      usage: translated.usage,
    });
    const english = translated.translations[0]?.english || voice.englishText || voice.originalText;
    await prisma.voice.update({
      where: { id: voice.id },
      data: { englishText: english, translated: english.trim() !== voice.originalText.trim(), pipelineStep: "translate" },
    });
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
    if (getConfig().aiMode === "live" && review.realPerson && !review.copyPaste && !review.duplicate) {
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

export async function tickBook(bookId: string) {
  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book) return { processed: 0, paused: false };
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
