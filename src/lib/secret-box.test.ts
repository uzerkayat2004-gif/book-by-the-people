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
