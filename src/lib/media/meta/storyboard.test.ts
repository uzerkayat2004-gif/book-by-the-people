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

describe("withPicture", () => {
  it("adds a picture after the last scene when a chapter has none", async () => {
    const { withPicture } = await import("./storyboard");
    const board = withPicture({ scenes: [{ kind: "quote", segment: 0, quote: 0 }] }, 3, "A kitchen");
    expect(board.scenes).toEqual([{ kind: "quote", segment: 0, quote: 0 }, { kind: "picture", segment: 1, prompt: "A kitchen" }]);
    const kept = withPicture({ scenes: [{ kind: "picture", segment: 0, prompt: "x" }] }, 3, "A kitchen");
    expect(kept.scenes).toHaveLength(1);
    const card = withPicture({ scenes: [{ kind: "card", segment: 0 }] }, 1, "A kitchen");
    expect(card.scenes[0].kind).toBe("picture");
  });
});

describe("paceScenes", () => {
  it("caps quotes at about 8 s and fills the rest with pictures, same chapter first, never twice in a row", async () => {
    const { paceScenes } = await import("./storyboard");
    const scenes = [
      { startMs: 0, endMs: 6000, kind: "picture", image: "a", unit: 1, chapter: "One" },
      { startMs: 6000, endMs: 30000, kind: "quote", unit: 1 },
      { startMs: 30000, endMs: 36000, kind: "picture", image: "b", unit: 2 },
      { startMs: 36000, endMs: 40000, kind: "end" },
    ];
    const out = paceScenes(scenes, 8000);
    // No gaps, same total.
    for (let i = 1; i < out.length; i += 1) expect(out[i].startMs).toBe(out[i - 1].endMs);
    expect(out[out.length - 1].endMs).toBe(40000);
    const quotes = out.filter((s) => s.kind === "quote");
    expect(quotes).toHaveLength(1);
    expect(quotes[0].endMs - quotes[0].startMs).toBeLessThanOrEqual(8000);
    for (const s of out) if (s.kind !== "end") expect(s.endMs - s.startMs).toBeLessThanOrEqual(14000);
    for (let i = 1; i < out.length; i += 1) if (out[i].image) expect(out[i].image).not.toBe(out[i - 1].image);
    // The first fill comes from the same chapter.
    expect(out[2]).toMatchObject({ kind: "picture", image: "a", chapter: undefined });
  });
  it("leaves scenes alone when there are no pictures", async () => {
    const { paceScenes } = await import("./storyboard");
    const scenes = [{ startMs: 0, endMs: 30000, kind: "quote" }];
    expect(paceScenes(scenes)).toEqual(scenes);
  });
});

import { featureOverlays, parseFeatureBoard, picturesFor, plainFeatureBoard } from "./storyboard";

describe("documentary storyboard", () => {
  it("uses about one picture every half minute", () => {
    expect(picturesFor(10_000, 0)).toBe(1);
    expect(picturesFor(150_000, 2)).toBe(5);
    expect(picturesFor(900_000, 2)).toBe(6);
  });

  it("keeps only pictures, in order, starting at the top", () => {
    const board = parseFeatureBoard({ scenes: [{ segment: 3, prompt: "a door" }, { segment: 2, prompt: "x" }, { segment: 6, prompt: "a field" }] }, 10, 3);
    expect(board.scenes).toEqual([
      { kind: "picture", segment: 0, prompt: "a door" },
      { kind: "picture", segment: 6, prompt: "a field" },
    ]);
    expect(plainFeatureBoard(9, 3, "p").scenes.map((s) => s.segment)).toEqual([0, 3, 6]);
  });

  it("times quote lower-thirds and count chips to the narration", () => {
    const overlays = featureOverlays({
      segments: [{ ref: "c0" }, { ref: "q1" }, { ref: "p2" }, { ref: "q3" }],
      timeOf: (seg) => ({ startMs: seg * 10_000, endMs: seg * 10_000 + 8000 }),
      quoteAt: (i) => ({ text: `quote ${i}`, who: "Priya", sub: "Chennai, India" }),
      countAt: () => ({ count: 46, label: "Teachers who stay" }),
    });
    expect(overlays.map((o) => o.kind)).toEqual(["count", "quote", "quote"]);
    expect(overlays[1]).toMatchObject({ startMs: 9750, endMs: 18_900, who: "Priya" });
    const quotes = overlays.filter((o) => o.kind === "quote");
    expect(quotes[0].endMs).toBeLessThan(quotes[1].startMs);
  });
});
