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
