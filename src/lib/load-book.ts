import "server-only";
import { cookies } from "next/headers";
import { getCurrentUser } from "./auth";
import { parseDocument } from "./book/assemble";
import type { BookDocument } from "./book/types";
import { countryStats } from "./countries";
import { prisma } from "./db";
import { spendPaused } from "./services/spend";
import { syncClosed } from "./services/books";

export async function loadBookBySlug(slug: string) {
  const found = await prisma.book.findUnique({
    where: { slug },
    include: {
      creator: true,
      voices: { orderBy: { createdAt: "asc" } },
      pollOptions: { orderBy: { position: "asc" }, include: { _count: { select: { votes: true } } } },
    },
  });
  if (!found) return null;
  const closed = await syncClosed(found);
  return { ...found, status: closed.status, closesAt: closed.closesAt };
}

export function readyVoices<T extends { status: string; hidden: boolean }>(voices: T[]) {
  return voices.filter((voice) => voice.status === "READY" && !voice.hidden);
}

export async function stageCountries(voices: { countryCode: string | null; status: string; hidden: boolean }[]) {
  return countryStats(readyVoices(voices));
}

export async function currentDocument(bookId: string, draftId: string | null): Promise<BookDocument | null> {
  if (!draftId) return null;
  const draft = await prisma.bookDraft.findFirst({ where: { id: draftId, bookId } });
  return draft ? parseDocument(draft.contentJson) : null;
}

/** Every key this visitor votes under: their account (if signed in), then this browser's voter cookie. */
export async function voterKeys(): Promise<string[]> {
  const jar = await cookies();
  const user = await getCurrentUser().catch(() => null);
  const cookie = jar.get("bbtp_voter")?.value;
  return [user ? `u:${user.id}` : "", cookie ?? ""].filter(Boolean);
}

export async function voterChoice(bookId: string) {
  const keys = await voterKeys();
  if (!keys.length) return null;
  const vote = await prisma.pollVote.findFirst({ where: { bookId, voterKey: { in: keys } } });
  return vote?.optionId ?? null;
}

export async function pausedNow(bookId: string) {
  return spendPaused(bookId);
}
