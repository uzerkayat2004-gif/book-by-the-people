import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for per-book AI keys. The server secret comes from
 * AI_KEY_SECRET; nothing is ever stored or logged in plain text.
 * Format: v1.<iv>.<tag>.<ciphertext>, each part base64url.
 */
function secretKey(secret = process.env.AI_KEY_SECRET ?? ""): Buffer {
  if (!secret || secret.length < 16) {
    throw new Error("AI_KEY_SECRET is not set (16+ characters), so per-book AI keys cannot be stored.");
  }
  return createHash("sha256").update(secret).digest();
}

export function canStoreKeys(): boolean {
  return (process.env.AI_KEY_SECRET ?? "").length >= 16;
}

export function sealKey(plain: string, secret?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(secret), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), body.toString("base64url")].join(".");
}

export function openKey(sealed: string, secret?: string): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("Stored AI key is not readable.");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}
