import { describe, expect, it } from "vitest";
import { assembleBook } from "./assemble";
import { reviewVoice, stripPeopleCounts } from "./checks";
import type { SourceVoice } from "./types";

function voice(id: string, text: string): SourceVoice {
  return {
    id,
    contributorName: "Nia",
    language: "en",
    countryCode: "IN",
    originalText: text,
    englishText: text,
    translated: false,
    turns: [],
    durationMs: 4000,
    createdAt: 1,
    kind: "voice",
    sourceUrl: null,
    sourceTitle: null,
    hidden: false,
    status: "READY",
    startWord: "flower",
    hasAudio: true,
  };
}

describe("voice checks", () => {
  it("approves a voice that stays on the question", () => {
    const review = reviewVoice({
      id: "a",
      question: "What keeps you awake on a night shift?",
      text: "The night shift is quiet and I keep thinking.",
      name: "Nia",
      startWordPassed: true,
      kind: "voice",
      sourceUrl: null,
      others: [],
    });
    expect(review.decision).toBe("approved");
    expect(review.onTopic).toBe(true);
    expect(review.duplicate).toBe(false);
  });

  it("marks a copied voice as not used", () => {
    const text = "The night shift is quiet and I keep thinking about the same hallway.";
    const review = reviewVoice({
      id: "b",
      question: "What keeps you awake on a night shift?",
      text,
      name: "Nia",
      startWordPassed: true,
      kind: "voice",
      sourceUrl: null,
      others: [{ id: "a", text }],
    });
    expect(review.copyPaste).toBe(true);
    expect(review.decision).toBe("not_used");
  });

  it("does not invent a count line inside chapter prose", () => {
    const document = assembleBook({
      title: "Night shift notes",
      question: "What keeps you awake on a night shift?",
      bookType: "OPEN",
      voices: [voice("a", "The night shift is quiet and I keep thinking.")],
      now: "2026-10-27T00:00:00.000Z",
    });
    const blob = JSON.stringify(document);
    expect(blob.toLowerCase()).not.toContain("people said");
    expect(stripPeopleCounts("3 people said this in the chapter")).toBe("in the chapter");
  });
});
