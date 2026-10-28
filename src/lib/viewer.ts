import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getCurrentUser } from "./auth";

const GUEST = "bbtp_guest";

function hashGuest(raw: string) {
  return createHash("sha256").update(`bbtp-guest:${raw}`).digest("hex");
}

/** Who is looking: the signed-in user (if any) and the hashed guest key their browser holds (if any). */
export async function getViewer() {
  const user = await getCurrentUser();
  const jar = await cookies();
  const raw = jar.get(GUEST)?.value ?? "";
  return { user, viewer: user ? { id: user.id } : null, guestKey: raw ? hashGuest(raw) : null };
}

/** The guest key for this browser, made on first use. Only its hash is stored with the voice. */
export async function guestKeyForWrite(): Promise<string> {
  const jar = await cookies();
  let raw = jar.get(GUEST)?.value ?? "";
  if (!raw) {
    raw = randomBytes(24).toString("hex");
    jar.set(GUEST, raw, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return hashGuest(raw);
}
