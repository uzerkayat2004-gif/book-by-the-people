import "server-only";
import { prisma } from "../db";
import { AppError } from "../errors";
import { SAMPLE_PREFIX } from "../famous-quotes";

export const SAMPLE_USER = "seed-sample";

type Snapshot = {
  version: 1;
  takenAt: string;
  book: { title: string; question: string; status: string; currentDraftId: string | null; publishedDraftId: string | null };
  voices: Record<string, unknown>[];
  drafts: Record<string, unknown>[];
  votes: { optionId: string; voterKey: string; createdAt: string }[];
};

async function owned(bookId: string, userId: string) {
  const book = await prisma.book.findFirst({ where: { id: bookId, creatorId: userId } });
  if (!book) throw new AppError("That book is not in your studio.", 404);
  return book;
}

export { backupAge } from "../backup-age";

async function snapshotOf(bookId: string): Promise<Snapshot> {
  const book = await prisma.book.findUniqueOrThrow({ where: { id: bookId } });
  const voices = await prisma.voice.findMany({ where: { bookId } });
  const drafts = await prisma.bookDraft.findMany({ where: { bookId } });
  const votes = await prisma.pollVote.findMany({ where: { bookId } });
  return {
    version: 1,
    takenAt: new Date().toISOString(),
    book: {
      title: book.title,
      question: book.question,
      status: book.status,
      currentDraftId: book.currentDraftId,
      publishedDraftId: book.publishedDraftId,
    },
    voices: voices.map((voice) => ({ ...voice, consentAt: voice.consentAt.toISOString(), createdAt: voice.createdAt.toISOString() })),
    drafts: drafts.map((draft) => ({ ...draft, createdAt: draft.createdAt.toISOString() })),
    votes: votes.map((vote) => ({ optionId: vote.optionId, voterKey: vote.voterKey, createdAt: vote.createdAt.toISOString() })),
  };
}

export async function createBackup(bookId: string, userId: string, note = "Saved from the studio.") {
  await owned(bookId, userId);
  const snapshot = await snapshotOf(bookId);
  return prisma.backup.create({
    data: { bookId, voiceCount: snapshot.voices.length, label: "Just now", note, snapshot: JSON.stringify(snapshot) },
  });
}

export async function readBackup(bookId: string, userId: string, backupId: string) {
  await owned(bookId, userId);
  const backup = await prisma.backup.findFirst({ where: { id: backupId, bookId } });
  if (!backup) throw new AppError("That backup is gone.", 404);
  return backup;
}

/** Put voices, drafts and votes back exactly as they were. Saves the current state first. */
export async function restoreBackup(bookId: string, userId: string, backupId: string) {
  const backup = await readBackup(bookId, userId, backupId);
  if (!backup.snapshot) throw new AppError("This backup has no saved data to restore.");
  const snapshot = JSON.parse(backup.snapshot) as Snapshot;
  await createBackup(bookId, userId, "Saved automatically before a restore.");
  await prisma.$transaction(async (tx) => {
    await tx.pollVote.deleteMany({ where: { bookId } });
    await tx.pipelineJob.deleteMany({ where: { bookId } });
    await tx.voice.deleteMany({ where: { bookId } });
    await tx.book.update({ where: { id: bookId }, data: { currentDraftId: null, publishedDraftId: null } });
    await tx.bookDraft.deleteMany({ where: { bookId } });
    for (const draft of snapshot.drafts) {
      await tx.bookDraft.create({ data: { ...(draft as object), createdAt: new Date(String(draft.createdAt)) } as never });
    }
    for (const voice of snapshot.voices) {
      await tx.voice.create({
        data: { ...(voice as object), consentAt: new Date(String(voice.consentAt)), createdAt: new Date(String(voice.createdAt)) } as never,
      });
    }
    const options = new Set((await tx.pollOption.findMany({ where: { bookId }, select: { id: true } })).map((option) => option.id));
    for (const vote of snapshot.votes) {
      if (!options.has(vote.optionId)) continue;
      await tx.pollVote.create({ data: { bookId, optionId: vote.optionId, voterKey: vote.voterKey, createdAt: new Date(vote.createdAt) } });
    }
    await tx.book.update({
      where: { id: bookId },
      data: {
        status: snapshot.book.status,
        currentDraftId: snapshot.book.currentDraftId,
        publishedDraftId: snapshot.book.publishedDraftId,
      },
    });
  });
  return { voices: snapshot.voices.length };
}

/** Back up, then clear test voices, votes, drafts, jobs and spend. Settings and backups stay. */
export async function resetTestData(bookId: string, userId: string) {
  const book = await owned(bookId, userId);
  await createBackup(bookId, userId, "Saved automatically before a reset.");
  await prisma.$transaction(async (tx) => {
    await tx.pollVote.deleteMany({ where: { bookId } });
    await tx.pipelineJob.deleteMany({ where: { bookId } });
    await tx.voiceChallenge.deleteMany({ where: { bookId } });
    await tx.aiUsage.deleteMany({ where: { bookId } });
    await tx.voice.deleteMany({ where: { bookId } });
    await tx.book.update({
      where: { id: bookId },
      data: {
        currentDraftId: null,
        publishedDraftId: null,
        status: book.closesAt && book.closesAt.getTime() <= Date.now() ? "CLOSED" : "COLLECTING",
        publishedAt: null,
        generationError: null,
        generationLog: null,
      },
    });
    await tx.bookDraft.deleteMany({ where: { bookId } });
  });
}

export async function removeSampleData(bookId: string, userId: string) {
  await owned(bookId, userId);
  const removed = await prisma.voice.deleteMany({
    where: { bookId, OR: [{ userId: SAMPLE_USER }, { sourceTitle: { startsWith: SAMPLE_PREFIX } }] },
  });
  return removed.count;
}

export async function resetVotes(bookId: string, userId: string) {
  await owned(bookId, userId);
  const removed = await prisma.pollVote.deleteMany({ where: { bookId } });
  return removed.count;
}
