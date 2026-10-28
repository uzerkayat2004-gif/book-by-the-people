import "server-only";
import { prisma } from "./db";
import type { Prisma } from "@/generated/prisma/client";
import { parseDocument } from "./book/assemble";
import { releaseLabel } from "./stage";
import { cleanSearch, pageOf } from "./privacy";
import { OPEN_TYPES, canLeadHome } from "./public-rules";

export { OPEN_TYPES, canLeadHome };

/**
 * Everything the public pages list. Only public card fields are read here (title, topic, owner name,
 * voice count, dates). Voices, transcripts and drafts of unreleased books never leave this file.
 * Unlisted books are link-only: they never show in /books, the Library or on the home page.
 */

/** Released books: published with a published version. */
export const releasedWhere = { status: "PUBLISHED", publishedDraftId: { not: null } } as const;
/** Released and listed: what the Library shows. */
export const libraryWhere = { ...releasedWhere, unlisted: false } as const;

/** Books anyone can see while they collect voices or are being written. */
export const openWhere = { status: { in: ["COLLECTING", "CLOSED", "GENERATING", "REVIEW"] }, type: { in: OPEN_TYPES }, unlisted: false } as const;
/** Listed books taking anyone's voice right now: what /books shows. */
export const takingVoicesWhere = (): Prisma.BookWhereInput => ({
  type: "OPEN",
  status: "COLLECTING",
  unlisted: false,
  OR: [{ closesAt: null }, { closesAt: { gt: new Date() } }],
});

export const PAGE_SIZE = 12;

const homeInclude = {
  creator: { select: { name: true, email: true } },
  voices: { orderBy: { createdAt: "asc" as const } },
  pollOptions: { orderBy: { position: "asc" as const }, include: { _count: { select: { votes: true } } } },
};

/**
 * The home page book: the one the site admin featured (if the public can see it), else the newest book
 * taking voices, else the newest released book.
 */
export async function homeBook() {
  const featured = await prisma.book.findFirst({ where: { featured: true, unlisted: false }, include: homeInclude });
  if (featured && canLeadHome(featured)) return featured;
  return (
    (await prisma.book.findFirst({ where: { ...openWhere, status: "COLLECTING" }, include: homeInclude, orderBy: { createdAt: "desc" } })) ??
    (await prisma.book.findFirst({ where: libraryWhere, include: homeInclude, orderBy: { publishedAt: "desc" } }))
  );
}

/** Light version for the layout and /speak: just what the header needs. */
export async function homeBookLite() {
  const featured = await prisma.book.findFirst({
    where: { featured: true, unlisted: false },
    select: { id: true, slug: true, type: true, status: true, question: true, closesAt: true, publishedDraftId: true },
  });
  if (featured && canLeadHome(featured)) return lite(featured);
  const select = { id: true, slug: true, type: true, status: true, question: true, closesAt: true } as const;
  const book =
    (await prisma.book.findFirst({ where: { ...openWhere, status: "COLLECTING" }, select, orderBy: { createdAt: "desc" } })) ??
    (await prisma.book.findFirst({ where: libraryWhere, select, orderBy: { publishedAt: "desc" } }));
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
    where: takingVoicesWhere(),
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
  language: string;
  owner: string;
  closesLabel: string | null;
  closesIso: string | null;
  voices: number;
  countries: number;
};

const cardSelect: {
  id: true;
  slug: true;
  title: true;
  question: true;
  type: true;
  status: true;
  language: true;
  closesAt: true;
  creator: { select: { name: true, email: true } };
} = {
  id: true,
  slug: true,
  title: true,
  question: true,
  type: true,
  status: true,
  language: true,
  closesAt: true,
  creator: { select: { name: true, email: true } },
};

type CardRow = {
  id: string;
  slug: string;
  title: string;
  question: string;
  type: string;
  status: string;
  language: string;
  closesAt: Date | null;
  creator: { name: string | null };
};

function toCard(book: CardRow, voices: number): OpenBookCard {
  return {
    id: book.id,
    slug: book.slug,
    title: book.title,
    question: book.question,
    type: book.type,
    status: book.status,
    language: book.language,
    owner: ownerName(book.creator),
    closesLabel: book.closesAt ? releaseLabel(book.closesAt).split(" · ")[0] : null,
    closesIso: book.closesAt?.toISOString() ?? null,
    voices,
    // Where voices come from is part of the book; it stays sealed until release.
    countries: 0,
  };
}

/**
 * The owner's public name. Never an email address, and never the part before the @ (that is what a
 * new account is named by default), so nobody's address can be guessed from a book card.
 */
export function ownerName(creator: { name?: string | null; email?: string | null } | null | undefined): string {
  const clean = (creator?.name ?? "").trim();
  const local = (creator?.email ?? "").split("@")[0]?.trim().toLowerCase() ?? "";
  if (!clean || clean.includes("@") || (local && clean.toLowerCase() === local)) return "A reader";
  return clean.slice(0, 60);
}

/** Other books open right now (not the one on the home page), newest first. */
export async function openBooks(exceptId?: string | null, take = 6): Promise<OpenBookCard[]> {
  const books = await prisma.book.findMany({
    where: { ...takingVoicesWhere(), ...(exceptId ? { id: { not: exceptId } } : {}) },
    orderBy: { createdAt: "desc" },
    take,
    select: cardSelect,
  });
  const counts = await voiceCounts(books.map((book) => book.id));
  return books.map((book) => toCard(book, counts.get(book.id) ?? 0));
}

/** Case-insensitive "contains" on Postgres; SQLite (local dev) already ignores case for plain letters. */
function textMatch(q: string) {
  const postgres = /^postgres(ql)?:\/\//.test(process.env.DATABASE_URL ?? "");
  const contains = postgres ? { contains: q, mode: "insensitive" as const } : { contains: q };
  return { OR: [{ title: contains }, { question: contains }] };
}

/** /books: every listed book taking voices, searchable by topic, filterable by language, 12 a page. */
export async function browseOpenBooks(input: { q?: unknown; lang?: unknown; page?: unknown; size?: number }) {
  const q = cleanSearch(input.q);
  const lang = typeof input.lang === "string" && /^[a-zA-Z][a-zA-Z-]{1,15}$/.test(input.lang) ? input.lang : "";
  const base = takingVoicesWhere();
  const where: Prisma.BookWhereInput = { AND: [base, ...(q ? [textMatch(q)] : []), ...(lang ? [{ language: lang }] : [])] };
  const total = await prisma.book.count({ where });
  const paging = pageOf({ page: input.page, total, size: input.size ?? PAGE_SIZE });
  const [books, languages] = await Promise.all([
    prisma.book.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: paging.skip, take: paging.take, select: cardSelect }),
    prisma.book.groupBy({ by: ["language"], where: base, _count: { _all: true }, orderBy: { language: "asc" } }),
  ]);
  const counts = await voiceCounts(books.map((book) => book.id));
  return {
    q,
    lang,
    total,
    ...paging,
    books: books.map((book) => toCard(book, counts.get(book.id) ?? 0)),
    languages: languages.map((row) => ({ code: row.language, count: (row._count as { _all: number } | undefined)?._all ?? 0 })),
  };
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

const releasedSelect = {
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
} as const;

/** Released, listed books for the Library, newest first. */
export async function releasedBooks(options: { exceptId?: string | null; take?: number } = {}): Promise<ReleasedBook[]> {
  const books = await prisma.book.findMany({
    where: { ...libraryWhere, ...(options.exceptId ? { id: { not: options.exceptId } } : {}) },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: options.take,
    select: releasedSelect,
  });
  return releasedCards(books);
}

/** The Library: released, listed books only, searchable, 12 a page. */
export async function browseLibrary(input: { q?: unknown; page?: unknown; size?: number }) {
  const q = cleanSearch(input.q);
  const where = { AND: [libraryWhere, ...(q ? [textMatch(q)] : [])] };
  const total = await prisma.book.count({ where });
  const paging = pageOf({ page: input.page, total, size: input.size ?? PAGE_SIZE });
  const books = await prisma.book.findMany({
    where,
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }, { id: "asc" }],
    skip: paging.skip,
    take: paging.take,
    select: releasedSelect,
  });
  return { q, total, ...paging, books: await releasedCards(books) };
}

async function releasedCards(
  books: {
    id: string;
    slug: string;
    title: string;
    question: string;
    type: string;
    bookNumber: number;
    publishedAt: Date | null;
    publishedDraftId: string | null;
    audiobookKey: string | null;
    videoKey: string | null;
  }[],
): Promise<ReleasedBook[]> {
  const ids = books.map((book) => book.id);
  const [counts, countries, drafts] = await Promise.all([
    voiceCounts(ids),
    countryCounts(ids),
    prisma.bookDraft.findMany({
      where: { id: { in: books.map((book) => book.publishedDraftId).filter((id): id is string => Boolean(id)) } },
      select: { id: true, contentJson: true },
    }),
  ]);
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
    voices: counts.get(book.id) ?? 0,
    countries: countries.get(book.id) ?? 0,
    chapters: (book.publishedDraftId && chapters.get(book.publishedDraftId)) || 0,
    audio: Boolean(book.audiobookKey),
    video: Boolean(book.videoKey),
  }));
}

/** How many usable voices each book has: one grouped count, not a row per voice. */
async function voiceCounts(bookIds: string[]) {
  const map = new Map<string, number>();
  if (bookIds.length === 0) return map;
  const rows = await prisma.voice.groupBy({
    by: ["bookId"],
    where: { bookId: { in: bookIds }, hidden: false, status: "READY" },
    _count: { _all: true },
  });
  for (const row of rows) map.set(row.bookId, row._count._all);
  return map;
}

/** Countries per released book (only ever called for released books). */
async function countryCounts(bookIds: string[]) {
  const map = new Map<string, number>();
  if (bookIds.length === 0) return map;
  const rows = await prisma.voice.groupBy({
    by: ["bookId", "countryCode"],
    where: { bookId: { in: bookIds }, hidden: false, status: "READY", countryCode: { not: null } },
  });
  for (const row of rows) if (row.countryCode) map.set(row.bookId, (map.get(row.bookId) ?? 0) + 1);
  return map;
}

/** "Oct 26, 2026" in the site's time zone. */
export function dayLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Kolkata" }).format(date);
}
