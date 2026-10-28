import "server-only";
import { prisma } from "./db";
import { parseDocument } from "./book/assemble";
import { releaseLabel } from "./stage";

import { OPEN_TYPES, canLeadHome } from "./public-rules";

export { OPEN_TYPES, canLeadHome };

/** Released books: published with a published version. */
export const releasedWhere = { status: "PUBLISHED", publishedDraftId: { not: null } } as const;

/** Books anyone can see while they collect voices or are being written. */
export const openWhere = { status: { in: ["COLLECTING", "CLOSED", "GENERATING", "REVIEW"] }, type: { in: OPEN_TYPES } } as const;

const homeInclude = {
  voices: { orderBy: { createdAt: "asc" as const } },
  pollOptions: { orderBy: { position: "asc" as const }, include: { _count: { select: { votes: true } } } },
};

/**
 * The home page book: the one the site owner featured (if the public can see it), else the newest book
 * taking voices, else the newest released book.
 */
export async function homeBook() {
  const featured = await prisma.book.findFirst({ where: { featured: true }, include: homeInclude });
  if (featured && canLeadHome(featured)) return featured;
  return (
    (await prisma.book.findFirst({ where: { ...openWhere, status: "COLLECTING" }, include: homeInclude, orderBy: { createdAt: "desc" } })) ??
    (await prisma.book.findFirst({ where: releasedWhere, include: homeInclude, orderBy: { publishedAt: "desc" } }))
  );
}

/** Light version for the layout and /speak: just what the header needs. */
export async function homeBookLite() {
  const book = await homeBook();
  return book ? lite(book) : null;
}

function lite(book: { id: string; slug: string; type: string; status: string; question: string; closesAt: Date | null }) {
  return { id: book.id, slug: book.slug, type: book.type, status: book.status, question: book.question, closesAt: book.closesAt };
}

/** The book "Add your voice" (/speak) goes to: the home book when it takes voices, else the newest open one. */
export async function voiceBookLite() {
  const home = await homeBookLite();
  if (home && home.type === "OPEN" && home.status === "COLLECTING") return home;
  const open = await prisma.book.findFirst({
    where: { type: "OPEN", status: "COLLECTING" },
    orderBy: { createdAt: "desc" },
    select: { id: true, slug: true, type: true, status: true, question: true, closesAt: true },
  });
  return open ? lite(open) : home;
}

export type OpenBookCard = {
  id: string;
  slug: string;
  title: string;
  question: string;
  type: string;
  status: string;
  closesLabel: string | null;
  voices: number;
  countries: number;
};

/** Other books open right now (not the one on the home page), newest first. */
export async function openBooks(exceptId?: string | null, take = 6): Promise<OpenBookCard[]> {
  const books = await prisma.book.findMany({
    where: { ...openWhere, status: "COLLECTING", ...(exceptId ? { id: { not: exceptId } } : {}) },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, slug: true, title: true, question: true, type: true, status: true, closesAt: true },
  });
  const counts = await voiceCounts(books.map((book) => book.id));
  return books.map((book) => ({
    id: book.id,
    slug: book.slug,
    title: book.title,
    question: book.question,
    type: book.type,
    status: book.status,
    closesLabel: book.closesAt ? releaseLabel(book.closesAt).split(" · ")[0] : null,
    ...(counts.get(book.id) ?? { voices: 0, countries: 0 }),
  }));
}

export type ReleasedBook = {
  id: string;
  slug: string;
  title: string;
  question: string;
  type: string;
  bookNumber: number;
  releasedLabel: string;
  releasedIso: string | null;
  voices: number;
  countries: number;
  chapters: number;
  audio: boolean;
  video: boolean;
};

/** Released books for the Library, newest first. */
export async function releasedBooks(options: { exceptId?: string | null; take?: number } = {}): Promise<ReleasedBook[]> {
  const books = await prisma.book.findMany({
    where: { ...releasedWhere, ...(options.exceptId ? { id: { not: options.exceptId } } : {}) },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: options.take,
    select: {
      id: true,
      slug: true,
      title: true,
      question: true,
      type: true,
      bookNumber: true,
      publishedAt: true,
      publishedDraftId: true,
      audiobookKey: true,
      videoKey: true,
    },
  });
  const ids = books.map((book) => book.id);
  const counts = await voiceCounts(ids);
  const drafts = await prisma.bookDraft.findMany({
    where: { id: { in: books.map((book) => book.publishedDraftId).filter((id): id is string => Boolean(id)) } },
    select: { id: true, contentJson: true },
  });
  const chapters = new Map(
    drafts.map((draft) => {
      try {
        return [draft.id, parseDocument(draft.contentJson)?.chapters.length ?? 0] as const;
      } catch {
        return [draft.id, 0] as const;
      }
    }),
  );
  return books.map((book) => ({
    id: book.id,
    slug: book.slug,
    title: book.title,
    question: book.question,
    type: book.type,
    bookNumber: book.bookNumber,
    releasedLabel: book.publishedAt ? dayLabel(book.publishedAt) : "Released",
    releasedIso: book.publishedAt?.toISOString() ?? null,
    ...(counts.get(book.id) ?? { voices: 0, countries: 0 }),
    chapters: (book.publishedDraftId && chapters.get(book.publishedDraftId)) || 0,
    audio: Boolean(book.audiobookKey),
    video: Boolean(book.videoKey),
  }));
}

async function voiceCounts(bookIds: string[]) {
  const map = new Map<string, { voices: number; countries: number }>();
  if (bookIds.length === 0) return map;
  const voices = await prisma.voice.findMany({
    where: { bookId: { in: bookIds }, hidden: false, status: "READY" },
    select: { bookId: true, countryCode: true },
  });
  for (const id of bookIds) {
    const mine = voices.filter((voice) => voice.bookId === id);
    map.set(id, { voices: mine.length, countries: new Set(mine.map((voice) => voice.countryCode).filter(Boolean)).size });
  }
  return map;
}

/** "Oct 26, 2026" in the site's time zone. */
export function dayLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Kolkata" }).format(date);
}
