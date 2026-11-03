import { describe, expect, it } from "vitest";
import { captionChunks, findQuoteSegment, parseStoryboard, plainStoryboard, storyboardPrompt, unitQuotes } from "./storyboard";
import type { BookDocument } from "@/lib/book/types";

const doc = {
  title: "Night Buses",
  question: "Where do you think best?",
  preface: "People answered.",
  chapters: [
    {
      id: "c1",
      title: "Moving quiet",
      theme: "Thinking in motion",
      narrative: "Many think while moving.",
      quotes: [
        { id: "q1", speakerName: "Asha", countryCode: "IN", englishText: "The bus is my office at night.", originalText: "", hidden: false },
        { id: "q2", speakerName: "Hidden", countryCode: null, englishText: "Secret.", originalText: "", hidden: true },
        { id: "q3", speakerName: "Ben", countryCode: "GB", englishText: "Trains, for me.", originalText: "", hidden: false },
      ],
    },
  ],
} as unknown as BookDocument;

const script = {
  title: "Moving quiet",
  segments: [
    { text: "Chapter one. Moving quiet.", pause: "long" as const },
    { text: "Many think while moving.", pause: "short" as const },
    { text: "Asha said: The bus is my office at night.", pause: "short" as const },
    { text: "Ben said: Trains, for me.", pause: "long" as const },
  ],
};

describe("storyboard", () => {
  it("lists only visible quotes", () => {
    const quotes = unitQuotes(doc, 1);
    expect(quotes.map((q) => q.speaker)).toEqual(["Asha", "Ben"]);
    expect(unitQuotes(doc, 0)).toEqual([]);
  });

  it("keeps a model storyboard safe to play", () => {
    const board = parseStoryboard(
      {
        scenes: [
          { kind: "picture", segment: 1, prompt: "A bus at night", quote: -1 },
          { kind: "quote", segment: 2, prompt: "", quote: 0 },
          { kind: "quote", segment: 2, prompt: "", quote: 1 },
          { kind: "quote", segment: 3, prompt: "", quote: 0 },
          { kind: "quote", segment: 3, prompt: "", quote: 7 },
          { kind: "picture", segment: 9, prompt: "Too late", quote: -1 },
        ],
      },
      4,
      2,
      true,
    );
    expect(board.scenes).toEqual([
      { kind: "picture", segment: 0, prompt: "A bus at night" },
      { kind: "quote", segment: 2, quote: 0 },
    ]);
    expect(() => parseStoryboard({ scenes: [{ kind: "picture", segment: 0, prompt: "x" }] }, 4, 0, false)).toThrow();
    expect(() => parseStoryboard({}, 4, 0, true)).toThrow();
  });

  it("caps pictures per chapter", () => {
    const scenes = [0, 1, 2, 3].map((segment) => ({ kind: "picture", segment, prompt: `p${segment}`, quote: -1 }));
    expect(parseStoryboard({ scenes }, 4, 0, true).scenes).toHaveLength(3);
  });

  it("has a plain storyboard that shows each quote as it is read", () => {
    const quotes = unitQuotes(doc, 1);
    expect(findQuoteSegment(script, quotes[0])).toBe(2);
    const board = plainStoryboard({ unit: 1, script, quotes, pictures: false, title: "Moving quiet", question: doc.question });
    expect(board.scenes).toEqual([
      { kind: "card", segment: 0 },
      { kind: "quote", segment: 2, quote: 0 },
      { kind: "quote", segment: 3, quote: 1 },
    ]);
    expect(plainStoryboard({ unit: 1, script, quotes, pictures: true, title: "Moving quiet", question: doc.question }).scenes[0].kind).toBe("picture");
  });

  it("numbers the segments and quotes in the prompt and forbids text in pictures", () => {
    const prompt = storyboardPrompt({ unit: 1, total: 2, bookTitle: "Night Buses", question: doc.question, script, quotes: unitQuotes(doc, 1), pictures: true });
    expect(prompt.user).toContain("2. Asha said");
    expect(prompt.user).toContain('1. Ben: "Trains, for me."');
    expect(prompt.system).toMatch(/Never put words/);
  });

  it("splits long captions and keeps their timing", () => {
    const text = "word ".repeat(60).trim();
    const chunks = captionChunks({ startMs: 1000, endMs: 7000, text });
    expect(chunks.every((c) => c.text.length <= 84)).toBe(true);
    expect(chunks[0].startMs).toBe(1000);
    expect(chunks.at(-1)!.endMs).toBe(7000);
    expect(chunks.map((c) => c.text).join(" ")).toBe(text);
  });
});
