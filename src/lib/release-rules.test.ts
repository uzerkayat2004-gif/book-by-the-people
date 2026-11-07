import { describe, expect, it } from "vitest";
import { mergeModelReview, reviewVoice } from "@/lib/book/checks";
import { listenMinutes, placeLabel, presentHome, publicName } from "@/lib/present-home";

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
  it("shows a dot per kept voice with the name and place, and lists the people", () => {
    const view = presentHome({ ...input, liveGlobe: true });
    expect(view.pins).toHaveLength(1);
    expect(view.pins[0]).toMatchObject({ name: "Asha", place: "India" });
    expect(view.people).toEqual([{ name: "Asha", countryCode: "IN", place: "India" }]);
  });
  it("never sends words, emails or ids for an open book", () => {
    const voices = [
      { ...input.voices[0], originalText: "my secret words", englishText: "my secret words", contributorName: "asha.k@example.com", region: "Pune" },
    ];
    const view = presentHome({ ...input, voices, liveGlobe: true });
    const sent = JSON.stringify({ pins: view.pins, people: view.people, names: view.names, chapters: view.chapters, clips: view.clips });
    expect(sent).not.toContain("secret");
    expect(sent).not.toContain("@");
    expect(sent).not.toContain("example.com");
    expect(view.people[0]).toEqual({ name: "asha k", countryCode: "IN", place: "Pune, India" });
    expect(Object.keys(view.pins[0]).sort()).toEqual(["lat", "lng", "name", "place"]);
    expect(view.names).toEqual([]);
  });
  it("shows nothing for unlisted books", () => {
    const view = presentHome({ ...input, liveGlobe: false });
    expect(view.pins).toHaveLength(0);
    expect(view.people).toHaveLength(0);
  });
  it("uses the finished audiobook length for listen time", () => {
    expect(listenMinutes(0, 2_276_064)).toBe(5);
    expect(listenMinutes(0)).toBe(1);
    expect(listenMinutes(3)).toBe(1);
  });
  it("cleans names and places", () => {
    expect(publicName("  Uzer   Kayat ")).toBe("Uzer Kayat");
    expect(publicName("someone@gmail.com")).toBe("someone");
    expect(publicName("")).toBe("Someone");
    expect(placeLabel("India", "India")).toBe("India");
    expect(placeLabel("", "Japan")).toBe("Japan");
  });
});
