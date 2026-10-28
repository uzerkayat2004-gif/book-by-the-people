/**
 * Which books the public site may show. Books that take voices from anyone are OPEN or FAMOUS.
 * SOLO and INVITED books only appear once they are released. Drafts never appear.
 * Pure rules (no database), shared by src/lib/public-books.ts and tests.
 */
export const OPEN_TYPES = ["OPEN", "FAMOUS"];
export const OPEN_STATUSES = ["COLLECTING", "CLOSED", "GENERATING", "REVIEW"];

/** A book may lead the home page when the public can see it. */
export function canLeadHome(book: { status: string; type: string; publishedDraftId: string | null }) {
  if (book.status === "PUBLISHED") return Boolean(book.publishedDraftId);
  return OPEN_TYPES.includes(book.type) && OPEN_STATUSES.includes(book.status);
}

/** Released books are public in the Library; everything else stays off it. */
export function isReleased(book: { status: string; publishedDraftId: string | null }) {
  return book.status === "PUBLISHED" && Boolean(book.publishedDraftId);
}

/** Who may choose the book on the home page, from a SITE_ADMIN_EMAILS comma list. */
export function parseAdmins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function adminAllowed(email: string | null | undefined, admins: string[], production: boolean): boolean {
  if (!email) return false;
  if (admins.length === 0) return !production;
  return admins.includes(email.trim().toLowerCase());
}
