import { describe, expect, it } from "vitest";
import { scrubSecrets } from "./scrub";

// Fake, made-up values shaped like real keys. Not real keys.
const FAKE_GOOGLE = "AIza" + "Sy" + "FAKEfakeFAKEfakeFAKEfakeFAKEfake1234";
const FAKE_META = "LLM|" + "1234567890|" + "fakeFAKEfakeFAKEfake";
const FAKE_OPENAI = "sk-" + "proj-" + "FAKEfakeFAKEfake5678";

describe("scrubSecrets", () => {
  it("removes key-shaped strings", () => {
    const text = `bad key ${FAKE_GOOGLE} and ${FAKE_META} and ${FAKE_OPENAI}`;
    const out = scrubSecrets(text);
    expect(out).not.toContain("FAKEfake");
    expect(out).not.toContain("AIza");
    expect(out).not.toContain("LLM|");
    expect(out).toContain("bad key");
  });

  it("removes keyed query strings and bearer tokens", () => {
    const out = scrubSecrets("GET https://x.example/v1?key=abc123secret&alt=json Authorization: Bearer abcdefghijkl");
    expect(out).not.toContain("abc123secret");
    expect(out).not.toContain("abcdefghijkl");
    expect(out).toContain("alt=json");
  });

  it("removes an exact known key even with an unusual shape", () => {
    const own = "zz-custom-" + "fake-value-777";
    expect(scrubSecrets(`echo ${own} here`, own)).toBe("echo •••• here");
  });

  it("leaves normal text alone", () => {
    const text = "Meta: HTTP 401 Invalid API key. Check the key in Studio.";
    expect(scrubSecrets(text)).toBe(text);
  });
});
