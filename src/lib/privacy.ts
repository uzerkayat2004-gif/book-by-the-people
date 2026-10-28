/**
 * Who may see what. Pure rules (no database), used by every page and API route, and tested in privacy.test.ts.
 *
 * - Before a book is released, its voices, transcripts, drafts, chapters, AI output, media and settings
 *   are for its owner only. Not other users, not the site admin, not signed-out visitors.
 * - Anyone may see an open book's public card: title, topic, cover, owner name, voice count and deadline.
 * - A contributor may see and delete their own voice, and nothing else of the book.
 * - After release, the published version (and the voices used in it) is public.
 *
 * There is deliberately no admin override here. The site admin can only feature or delete a book.
 */

export type Viewer = { id: string } | null;
export type BookAccess = { creatorId: string; status: string; publishedDraftId: string | null };
export type VoiceAccess = { userId: string; guestKey: string; hidden: boolean; status: string };

export function isOwner(book: { creatorId: string }, viewer: Viewer): boolean {
  return Boolean(viewer?.id) && viewer!.id === book.creatorId;
}

export function isReleasedBook(book: { status: string; publishedDraftId: string | null }): boolean {
  return book.status === "PUBLISHED" && Boolean(book.publishedDraftId);
}

/** Chapters, quotes, names of contributors, media: the owner always, everyone else only after release. */
export function canReadBook(book: BookAccess, viewer: Viewer): boolean {
  return isOwner(book, viewer) || isReleasedBook(book);
}

/** Drafts, the studio, settings, keys, the voice list and transcripts: the owner only, before and after release. */
export function canManageBook(book: { creatorId: string }, viewer: Viewer): boolean {
  return isOwner(book, viewer);
}

/** The person who recorded a voice: by account, or by the private guest key their browser holds. */
export function isContributor(voice: { userId: string; guestKey: string }, viewer: Viewer, guestKey: string | null): boolean {
  if (viewer?.id && voice.userId && voice.userId === viewer.id) return true;
  return Boolean(guestKey) && Boolean(voice.guestKey) && voice.guestKey === guestKey;
}

/** The owner, or the person who recorded it, may delete a voice. */
export function canDeleteVoice(voice: VoiceAccess, book: { creatorId: string }, viewer: Viewer, guestKey: string | null): boolean {
  return isOwner(book, viewer) || isContributor(voice, viewer, guestKey);
}

/** A contributor's own receipt (their words, status, credit card) before release. */
export function canSeeOwnVoice(voice: VoiceAccess, book: { creatorId: string }, viewer: Viewer, guestKey: string | null): boolean {
  return isOwner(book, viewer) || isContributor(voice, viewer, guestKey);
}

/**
 * The recording itself. The owner and the contributor always; the public only once the book is released,
 * the voice is visible, and the published version actually quotes it.
 */
export function canHearVoice(input: {
  voice: VoiceAccess;
  book: BookAccess;
  viewer: Viewer;
  guestKey: string | null;
  usedInRelease: boolean;
}): boolean {
  const { voice, book, viewer, guestKey } = input;
  if (canSeeOwnVoice(voice, book, viewer, guestKey)) return true;
  if (!isReleasedBook(book)) return false;
  if (voice.hidden || voice.status !== "READY") return false;
  return input.usedInRelease;
}

/** Audiobook and film files: the owner before release, everyone after. */
export function canGetMedia(book: BookAccess, viewer: Viewer): boolean {
  return canReadBook(book, viewer);
}

/** Which draft a reader may open: the owner may preview the current one; everyone gets the published one. */
export function readableDraftId(
  book: BookAccess & { currentDraftId: string | null },
  viewer: Viewer,
  wantsPreview: boolean,
): string | null {
  if (wantsPreview && isOwner(book, viewer)) return book.currentDraftId;
  return isReleasedBook(book) ? book.publishedDraftId : null;
}

/** The only fields of an unreleased book anyone else may see. */
export const PUBLIC_BOOK_FIELDS = ["id", "slug", "title", "question", "type", "status", "coverVibe", "language", "closesAt", "publishedAt", "unlisted"] as const;

/** Page numbers for listings: 1-based, clamped, with how many pages there are. */
export function pageOf(input: { page: unknown; total: number; size: number }) {
  const size = Math.max(1, Math.floor(input.size));
  const pages = Math.max(1, Math.ceil(Math.max(0, input.total) / size));
  const asked = Math.floor(Number(input.page));
  const page = Number.isFinite(asked) && asked >= 1 ? Math.min(asked, pages) : 1;
  return { page, pages, size, skip: (page - 1) * size, take: size, hasPrev: page > 1, hasNext: page < pages };
}

/** A search box value made safe for a query: trimmed, short, single spaces. */
export function cleanSearch(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 80) : "";
}
