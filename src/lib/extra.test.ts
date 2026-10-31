import { describe, expect, it } from "vitest";
import { backupAge } from "./backup-age";
import { mergeModelReview, stripPeopleCounts } from "./book/checks";
import { themeLabel } from "./book/plan";
import { isLand } from "./land-mask";
import { FAMOUS_RECORD, FAMOUS_SAMPLES, SAMPLE_PREFIX } from "./famous-quotes";

const base = {
  onTopic: true,
  realPerson: true,
  copyPaste: false,
  impersonation: false,
  duplicate: false,
  decision: "approved" as const,
  theme: "Thinking",
  notes: [] as string[],
};

describe("backupAge", () => {
  const now = Date.parse("2026-10-27T12:00:00Z");
  const ago = (ms: number) => backupAge(new Date(now - ms), now);
  it("reads like the live Studio", () => {
    expect(ago(30_000)).toBe("Just now");
    expect(ago(5 * 60_000)).toBe("5 minutes ago");
    expect(ago(60 * 60_000)).toBe("1 hour ago");
    expect(ago(26 * 3600_000)).toBe("Yesterday");
    expect(ago(4 * 86_400_000)).toBe("4 days ago");
  });
});

describe("mergeModelReview", () => {
  it("keeps one decision and lets the model flag off-topic", () => {
    const merged = mergeModelReview(base, { onTopic: false, impersonation: false, theme: "Shortcuts" }, "voice");
    expect(merged.decision).toBe("needs_you");
    expect(merged.notes[0]).toBe("Off the question.");
    expect(merged.theme).toBe("Shortcuts");
  });
  it("routes impersonation to a person", () => {
    const merged = mergeModelReview(base, { onTopic: true, impersonation: true, theme: "" }, "voice");
    expect(merged.decision).toBe("needs_you");
    expect(merged.theme).toBe("Thinking");
  });
  it("never flags impersonation on a sourced famous quote", () => {
    expect(mergeModelReview(base, { onTopic: true, impersonation: true, theme: "x" }, "sourced_quote").decision).toBe("approved");
  });
  it("hides a voice that failed the real-person check", () => {
    expect(mergeModelReview({ ...base, realPerson: false }, { onTopic: true, impersonation: false, theme: "x" }, "voice").decision).toBe("hidden");
  });
});

describe("reader text", () => {
  it("drops people counts", () => {
    expect(stripPeopleCounts("Tools help. 12 people said this")).toBe("Tools help.");
  });
  it("themes come from the voices' own words", () => {
    const label = themeLabel([{ text: "I check the answer before I trust it." }, { text: "Now I always check the answer twice." }]);
    expect(label.toLowerCase()).toContain("check the answer");
  });
});

describe("globe land mask", () => {
  it("knows land from sea", () => {
    expect(isLand(21, 78)).toBe(true); // India
    expect(isLand(40, -100)).toBe(true); // USA
    expect(isLand(0, -140)).toBe(false); // Pacific
    expect(isLand(-30, 80)).toBe(false); // Indian Ocean
  });
});

describe("famous quotes", () => {
  it("every quote keeps a real source URL and date; samples are labeled", () => {
    for (const quote of [...FAMOUS_RECORD, ...FAMOUS_SAMPLES]) {
      expect(quote.url).toMatch(/^https:\/\//);
      expect(quote.date).toMatch(/\d{3,4}/);
      expect(quote.text.length).toBeGreaterThan(20);
    }
    expect(SAMPLE_PREFIX).toMatch(/sample/i);
  });
});

import { dropStartWord } from "./book/speech";
describe("dropStartWord", () => {
  it("removes the spoken start word and capitalises the rest", () => {
    expect(dropStartWord("Tiger. every morning I hear vendors.", "tiger")).toBe("Every morning I hear vendors.");
  });
  it("keeps text that does not start with the word", () => {
    expect(dropStartWord("I said tiger later.", "tiger")).toBe("I said tiger later.");
  });
});
