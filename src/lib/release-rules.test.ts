import { describe, expect, it } from "vitest";
import { mergeModelReview, reviewVoice } from "@/lib/book/checks";
import { presentHome } from "@/lib/present-home";

const base = {
  id: "v2",
  question: "What small habit changed your life?",
  name: "Asha",
  startWordPassed: true,
  kind: "voice" as const,
  sourceUrl: null,
};

describe("second voice from the same person", () => {
  it("a short answer is kept, not refused", () => {
    const review = reviewVoice({ ...base, text: "Walking daily.", others: [{ id: "v1", text: "I read before bed every night and it calmed me." }] });
    expect(review.decision).toBe("approved");
  });
  it("a close rewording goes to the creator instead of being refused", () => {
    const first = "I read before bed every night and it calmed me down a lot.";
    const review = reviewVoice({ ...base, text: "I read before bed every night and it calmed me down.", others: [{ id: "v1", text: first }] });
    expect(review.decision).toBe("needs_you");
  });
  it("only the exact same words are refused", () => {
    const text = "I read before bed every night.";
    const review = reviewVoice({ ...base, text, others: [{ id: "v1", text }] });
    expect(review.decision).toBe("not_used");
    expect(review.notes).toContain("Same words as another voice.");
  });
  it("an AI off-topic call goes to the creator, not refused", () => {
    const review = reviewVoice({ ...base, text: "Walking daily.", others: [] });
    const merged = mergeModelReview(review, { onTopic: false, impersonation: false, theme: "Habits" }, "voice");
    expect(merged.decision).toBe("needs_you");
  });
});

describe("globe while a book is open", () => {
  const input = {
    status: "OPEN",
    question: "q",
    closesAt: null,
    publishedAt: null,
    slug: "s",
    paused: false,
    voiceHref: null,
    document: null,
    pollQuestion: "",
    poll: [],
    bookId: "b",
    yourVote: null,
    voices: [
      { id: "a", contributorName: "Asha", countryCode: "IN", status: "READY", hidden: false, storageKey: null, kind: "voice" },
      { id: "b", contributorName: "Ben", countryCode: "US", status: "NEEDS_YOU", hidden: false, storageKey: null, kind: "voice" },
    ],
  };
  it("shows an unnamed dot per kept voice", () => {
    const view = presentHome({ ...input, liveGlobe: true });
    const pins = view.pins;
    expect(pins).toHaveLength(1);
    expect(pins[0].name).toBe("");
  });
  it("shows nothing for unlisted books", () => {
    const view = presentHome({ ...input, liveGlobe: false });
    expect(view.pins).toHaveLength(0);
  });
});
