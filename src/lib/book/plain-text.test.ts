import { describe, expect, it } from "vitest";
import { bookPlainText } from "./plain-text";
import type { BookDocument, QuoteSpan } from "./types";

const quote = (id: string, text: string, name: string, code: string | null, hidden = false): QuoteSpan => ({
  id, voiceId: `v-${id}`, speakerName: name, language: "en", countryCode: code, originalText: text, englishText: text,
  startMs: 0, endMs: 0, kind: "voice", sourceUrl: null, sourceTitle: null, hidden, hasAudio: true,
});

const base: BookDocument = {
  title: "The Teacher Who Stayed",
  question: "What makes a good teacher?",
  bookType: "OPEN",
  preface: "Teachers came up again and again.",
  provider: "meta",
  model: "muse-spark-1.3",
  generatedAt: "2026-11-03T00:00:00Z",
  chapters: [
    {
      id: "c1", title: "Staying **After** Class", theme: "", narrative: "First paragraph.\n\nSecond paragraph.", agreement: "They stay.", disagreement: null,
      quotes: [quote("q1", "She stayed late.", "Asha", "IN"), quote("q2", "Hidden words.", "Bo", "KR", true)],
    },
    {
      id: "c2", title: "Laughter", theme: "", narrative: "", agreement: null, disagreement: null,
      quotes: [quote("q3", "He made us laugh.", "Ana", "BR"), quote("q4", "Ask why.", "A voice from Pune, India", "IN")],
      blocks: [{ kind: "p", text: "Laughter helped." }, { kind: "quote", quoteId: "q3" }, { kind: "p", text: "It still does." }, { kind: "quote", quoteId: "q4" }],
    },
  ],
  outline: { v: 1, form: "chapters", total: 92, countries: 10, arc: "", clusters: [], standouts: [], sections: [], steps: [] },
};

describe("bookPlainText", () => {
  it("has the whole book in reading order with counts, quotes and the ending", () => {
    const text = bookPlainText(base, { people: 3, countries: 2 });
    expect(text.startsWith("The Teacher Who Stayed\n\nWhat makes a good teacher?\n\nA book written by 92 people from 10 countries.")).toBe(true);
    const order = [
      "Teachers came up again and again.",
      "1. Staying After Class",
      "First paragraph.",
      "Second paragraph.",
      "“She stayed late.” — Asha, India",
      "Where people agree: They stay.",
      "2. Laughter",
      "Laughter helped.",
      "“He made us laugh.” — Ana, Brazil",
      "It still does.",
      "This book was made from the voices of 92 people.",
    ].map((part) => text.indexOf(part));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain("“Ask why.” — A voice from Pune, India\n");
    expect(text).not.toContain("Hidden words");
    expect(text).not.toContain("**");
    expect(text).not.toMatch(/notebooklm/i);
  });

  it("uses the page counts without an outline, and a continuous piece has no chapter headings", () => {
    const text = bookPlainText({ ...base, outline: undefined, form: "continuous" }, { people: 1, countries: 1 });
    expect(text).toContain("A book written by one person from one country.");
    expect(text).not.toContain("1. Staying After Class");
    expect(text).toContain("Laughter helped.");
  });

  it("writes the intro and ending in the book language", () => {
    const text = bookPlainText({ ...base, language: "es" }, { people: 0, countries: 0 });
    expect(text).toContain("Un libro escrito por 92 personas de 10 países.");
  });
});
