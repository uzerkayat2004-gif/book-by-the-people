import { describe, expect, it } from "vitest";
import { exactIn, guardQuotes, reflowBlocks, sizeHint, writeFeature } from "./feature";
import type { SourceVoice } from "./types";

const voice = (i: number, text: string, extra: Partial<SourceVoice> = {}): SourceVoice => ({
  id: `v${i}`,
  contributorName: `Person ${i}`,
  language: "en",
  countryCode: i % 3 ? "IN" : "KE",
  originalText: text,
  englishText: text,
  translated: false,
  turns: [],
  durationMs: 1000,
  createdAt: i,
  kind: "voice",
  sourceUrl: null,
  sourceTitle: null,
  hidden: false,
  status: "READY",
  startWord: "",
  hasAudio: false,
  ...extra,
});

describe("feature writer helpers", () => {
  it("finds exact words, ignoring case, spaces and curly quotes", () => {
    expect(exactIn("she  STAYED after class", "I think she stayed after class every day.")).toBe("she stayed after class");
    expect(exactIn("she left early", "I think she stayed after class.")).toBeNull();
  });

  it("says a group's size in plain words", () => {
    expect(sizeHint(7, 92)).toMatch(/seven/i);
    expect(sizeHint(46, 92)).toMatch(/40|50|half/i);
  });

  it("drops quote marks around words nobody said", () => {
    const out = guardQuotes('As one said, "patience is everything" and "made up line".', ["Patience is everything, really."]);
    expect(out).toContain("\u201Cpatience is everything\u201D");
    expect(out).not.toMatch(/["\u201C]made up line/);
  });

  it("puts edited paragraphs back in place and keeps quotes", () => {
    const blocks = [
      { kind: "p" as const, text: "One." },
      { kind: "quote" as const, quoteId: "q1" },
      { kind: "p" as const, text: "Two." },
    ];
    const out = reflowBlocks(blocks, "One again.\n\nTwo again.");
    expect(out.map((b) => b.kind)).toEqual(["p", "quote", "p"]);
    expect(out[0]).toMatchObject({ text: "One again." });
    expect(out[2]).toMatchObject({ text: "Two again." });
  });
});

describe("writeFeature without a model", () => {
  it("still builds a whole book with an outline, and never names an unverified famous name", async () => {
    const voices = [
      ...Array.from({ length: 30 }, (_, i) => voice(i, `A good teacher listens to every student and stays patient, number ${i}.`)),
      voice(90, "Teachers who shout made me hate school.", { contributorName: "Elon Musk", nameUnverified: true }),
    ];
    const doc = await writeFeature({ title: "T", question: "What makes a good teacher?", bookType: "anthology", language: "en", languageName: "English", voices, ask: null, provider: "none", model: "none" });
    expect(doc.outline?.total).toBe(31);
    expect(doc.chapters.length).toBeGreaterThan(0);
    expect(doc.chapters.every((c) => c.blocks && c.blocks.length > 0)).toBe(true);
    expect(JSON.stringify(doc)).not.toContain("Elon Musk");
  });

  it("writes one continuous piece when almost everyone agrees", async () => {
    const voices = Array.from({ length: 20 }, (_, i) => voice(i, `Every child must learn to swim, it saves lives ${i}.`));
    const ask = async (input: { step: string }) => {
      if (input.step.startsWith("map")) return { groups: [{ label: "Swimming saves lives", summary: "Everyone says it saves lives.", refs: voices.map((_, i) => `v${i + 1}`), phrases: [], standouts: [] }] };
      throw new Error("offline");
    };
    const doc = await writeFeature({ title: "Into the Water", question: "Should every child learn to swim?", bookType: "anthology", language: "en", languageName: "English", voices, ask, provider: "x", model: "y" });
    expect(doc.form).toBe("continuous");
    expect(doc.chapters).toHaveLength(1);
  });
});
