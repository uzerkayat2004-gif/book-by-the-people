import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "@/lib/runtime-fs";
import path from "node:path";

/**
 * AES-256-GCM for stored AI keys (per-book keys and the creator's AI models).
 * The server secret comes from AI_KEY_SECRET. When it is unset, a random
 * secret is generated once into data/ai-key-secret (git-ignored) so local
 * setups can store keys without extra steps. Nothing is stored or logged in
 * plain text.
 * Format: v1.<iv>.<tag>.<ciphertext>, each part base64url.
 */

let cachedLocal: string | null = null;

export function localSecretPath(): string {
  return [process.env.DATA_DIR || [process.cwd(), "data"].join(path.sep), "ai-key-secret"].join(path.sep);
}

/** Reads (or creates once) the local secret file. Returns "" if it cannot be written. */
export function localSecret(file = localSecretPath()): string {
  if (cachedLocal && file === localSecretPath()) return cachedLocal;
  try {
    if (existsSync(file)) {
      const value = readFileSync(file, "utf8").trim();
      if (value.length >= 16) {
        if (file === localSecretPath()) cachedLocal = value;
        return value;
      }
    }
    mkdirSync(path.dirname(file), { recursive: true });
    const value = randomBytes(32).toString("base64url");
    writeFileSync(file, `${value}\n`, { encoding: "utf8", mode: 0o600 });
    try {
      chmodSync(file, 0o600);
    } catch {
      // Windows has no POSIX modes; the file still sits in the git-ignored data/ folder.
    }
    if (file === localSecretPath()) cachedLocal = value;
    return value;
  } catch {
    return "";
  }
}

/** The secret in use: AI_KEY_SECRET when it is 16+ characters, else the local file. */
export function activeSecret(): string {
  const env = process.env.AI_KEY_SECRET ?? "";
  if (env.length >= 16) return env;
  return localSecret();
}

function secretKey(secret = activeSecret()): Buffer {
  if (!secret || secret.length < 16) {
    throw new Error("AI_KEY_SECRET is not set (16+ characters) and data/ai-key-secret could not be created, so AI keys cannot be stored.");
  }
  return createHash("sha256").update(secret).digest();
}

export function canStoreKeys(): boolean {
  return activeSecret().length >= 16;
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

/** Last four characters for display. Short keys show only dots. */
export function keyLast4(plain: string): string {
  const key = plain.trim();
  return key.length >= 8 ? key.slice(-4) : "";
}
