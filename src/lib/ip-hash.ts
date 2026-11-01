import "server-only";
import { createHmac } from "node:crypto";
import { activeSecret } from "./secret-box";

/** A keyed hash of a network address. The address itself is never stored. "" when unknown. */
export function ipHash(ip: string): string {
  if (!ip || ip === "local") return "";
  const pepper = process.env.BLOB_PATH_SECRET || activeSecret() || "bbtp";
  return createHmac("sha256", pepper).update(`ip:${ip}`).digest("hex").slice(0, 32);
}
