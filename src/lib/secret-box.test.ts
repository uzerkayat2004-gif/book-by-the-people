import { describe, expect, it } from "vitest";
import { openKey, sealKey } from "./secret-box";

describe("per-book AI key sealing", () => {
  const secret = "test-secret-at-least-16";
  it("round-trips and never contains the plain key", () => {
    const sealed = sealKey("sk-live-abc123", secret);
    expect(sealed).not.toContain("abc123");
    expect(openKey(sealed, secret)).toBe("sk-live-abc123");
  });
  it("uses a fresh IV every time", () => {
    expect(sealKey("same", secret)).not.toBe(sealKey("same", secret));
  });
  it("fails with the wrong secret", () => {
    const sealed = sealKey("k", secret);
    expect(() => openKey(sealed, "another-secret-16chars")).toThrow();
  });
  it("is real AES-GCM ciphertext, not an encoding of the key, and refuses tampering", () => {
    const plain = "AIza" + "FAKEfakeFAKEfakeFAKEfakeFAKEfake12";
    const sealed = sealKey(plain, secret);
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain(Buffer.from(plain).toString("base64").slice(0, 12));
    expect(sealed).not.toContain(Buffer.from(plain).toString("base64url").slice(0, 12));
    expect(sealed).not.toContain(Buffer.from(plain).toString("hex").slice(0, 12));
    const [v, iv, tag, body] = sealed.split(".");
    const flipped = body.slice(0, -1) + (body.endsWith("A") ? "B" : "A");
    expect(() => openKey([v, iv, tag, flipped].join("."), secret)).toThrow();
  });
  it("refuses a short secret", () => {
    expect(() => sealKey("k", "short")).toThrow(/AI_KEY_SECRET/);
  });
});

describe("local key secret", () => {
  it("creates data/ai-key-secret once when AI_KEY_SECRET is unset, and reuses it", async () => {
    const { mkdtempSync, readFileSync, statSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const { localSecret, keyLast4 } = await import("./secret-box");
    const dir = mkdtempSync(path.join(tmpdir(), "bbtp-secret-"));
    const file = path.join(dir, "ai-key-secret");
    const first = localSecret(file);
    expect(first.length).toBeGreaterThanOrEqual(32);
    expect(readFileSync(file, "utf8").trim()).toBe(first);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o077).toBe(0);
    expect(localSecret(file)).toBe(first);
    const sealed = sealKey("sk-local-secret-key", first);
    expect(openKey(sealed, first)).toBe("sk-local-secret-key");
    expect(keyLast4("sk-local-secret-key")).toBe("-key");
    expect(keyLast4("short")).toBe("");
  });
});

describe("production key secret", () => {
  it("refuses to fall back to a generated file in production", async () => {
    const env = process.env as Record<string, string | undefined>;
    const before = { node: env.NODE_ENV, secret: env.AI_KEY_SECRET, dir: env.DATA_DIR };
    try {
      env.NODE_ENV = "production";
      delete env.AI_KEY_SECRET;
      delete env.DATA_DIR;
      const { canStoreKeys } = await import("./secret-box");
      expect(canStoreKeys()).toBe(false);
      env.AI_KEY_SECRET = "a-long-enough-production-secret";
      expect(canStoreKeys()).toBe(true);
    } finally {
      env.NODE_ENV = before.node;
      if (before.secret === undefined) delete env.AI_KEY_SECRET; else env.AI_KEY_SECRET = before.secret;
      if (before.dir === undefined) delete env.DATA_DIR; else env.DATA_DIR = before.dir;
    }
  });
});
