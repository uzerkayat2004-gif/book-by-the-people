import "server-only";
import { adminAllowed, parseAdmins } from "./public-rules";

/**
 * Who may choose the book on the home page. SITE_ADMIN_EMAILS is a comma list.
 * When it is empty, any signed-in creator may feature their own public book on a local or dev server,
 * and nobody may in production (the home page then picks the newest open book by itself).
 */
export function siteAdmins(): string[] {
  return parseAdmins(process.env.SITE_ADMIN_EMAILS);
}

export function isSiteAdmin(email: string | null | undefined): boolean {
  return adminAllowed(email, siteAdmins(), process.env.NODE_ENV === "production");
}
