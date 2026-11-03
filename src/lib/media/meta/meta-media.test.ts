import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { numberWords, sentencePieces, speakableEnglish, tokenize, tokenizerFrom } from "./text";
import { parseNarration, plainNarration, narrationUnits, narrationPrompt, unitSource } from "./narrate";
import { voiceOptions, mmsFor, isMetaWriter } from "./catalog";
import type { BookDocument } from "@/lib/book/types";

const doc: BookDocument = {
  title: "Night Buses",
  question: "Where do you think best?",
  bookType: "OPEN",
  preface: "People from many cities answered.",
  provider: "mock",
  model: "mock",
  generatedAt: "",
  chapters: [
    {
      id: "c1",
      title: "Moving quiet",
      theme: "",
      narrative: "Many think while moving.",
      agreement: "Motion helps.",
      disagreement: null,
      quotes: [
        { id: "q1", voiceId: "v1", speakerName: "Asha", language: "en", countryCode: "IN", originalText: "", englishText: "The bus is my office.", startMs: 0, endMs: 1, kind: "voice", sourceUrl: null, sourceTitle: null, hidden: false, hasAudio: false },
        { id: "q2", voiceId: "v2", speakerName: "Hidden", language: "en", countryCode: null, originalText: "", englishText: "Secret.", startMs: 0, endMs: 1, kind: "voice", sourceUrl: null, sourceTitle: null, hidden: true, hasAudio: false },
      ],
    },
  ],
};

describe("Meta voice text", () => {
  it("spells numbers for English", () => {
    expect(numberWords(21)).toBe("twenty-one");
    expect(numberWords(1999)).toBe("one thousand nine hundred ninety-nine");
    expect(speakableEnglish("50% of 3 people & 1,200 votes")).toBe("fifty percent of three people and one thousand two hundred votes");
  });

  it("packs sentences and cuts long ones", () => {
    const pieces = sentencePieces("One. Two! " + "word, ".repeat(100), 120);
    expect(pieces[0]).toBe("One.");
    expect(pieces.every((p) => p.length <= 121)).toBe(true);
    expect(sentencePieces("राम घर गया। सीता आई।")).toEqual(["राम घर गया।", "सीता आई।"]);
  });

  it("tokenizes like the MMS tokenizer (blank between letters, unknown letters dropped)", () => {
    const tok = tokenizerFrom(
      JSON.stringify({
        model: { vocab: { k: 0, a: 1, b: 2, " ": 3 } },
        normalizer: { normalizers: [{ type: "Lowercase" }, { type: "Replace", pattern: { Regex: "[^kab ]" }, content: "" }] },
        added_tokens: [{ id: 4, content: "<unk>" }],
      }),
    );
    expect(tokenize(tok, "AB, a!")).toEqual([0, 1, 0, 2, 0, 3, 0, 1, 0]);
    expect(tokenize(tok, "!!!")).toEqual([]);
  });
});

describe("narration", () => {
  it("has an opening plus one unit per chapter", () => {
    expect(narrationUnits(doc)).toBe(2);
    expect(unitSource(doc, 1).text).toContain('Quote from Asha: "The bus is my office."');
    expect(unitSource(doc, 1).text).not.toContain("Secret");
  });

  it("reads model JSON and drops markup", () => {
    const out = parseNarration({ title: "T", segments: [{ text: "**Hello** there.", pause: "long" }, { text: "", pause: "none" }, { text: "Next.", pause: "weird" }] });
    expect(out.segments).toEqual([
      { text: "Hello there.", pause: "long" },
      { text: "Next.", pause: "short" },
    ]);
    expect(() => parseNarration({ segments: [] })).toThrow();
    expect(() => parseNarration("nope")).toThrow();
  });

  it("falls back to a plain script with quotes and a long closing pause", () => {
    const plain = plainNarration(doc, 1);
    expect(plain.segments.map((s) => s.text)).toContain("Asha said: The bus is my office.");
    expect(plain.segments.at(-1)?.pause).toBe("long");
    expect(plainNarration(doc, 0).segments[0].text).toBe("Night Buses.");
  });

  it("asks for the right language and the closing line on the last chapter", () => {
    const prompt = narrationPrompt({ unit: 1, total: 2, languageName: "Hindi", bookTitle: "B", source: "x" });
    expect(prompt.system).toContain("in Hindi");
    expect(prompt.system).toContain("last chapter");
  });
});

describe("voices", () => {
  it("offers only the Meta voice when Meta-only is on", () => {
    expect(voiceOptions("en", true).map((v) => v.id)).toEqual(["mms-eng"]);
    expect(voiceOptions("en", false).map((v) => v.id)).toEqual(["mms-eng", "espeak"]);
    expect(voiceOptions("ja", true)).toEqual([]);
    expect(voiceOptions("ja", false)[0].recommended).toBe(true);
    expect(mmsFor("hi-IN")?.code).toBe("hin");
  });

  it("knows which Meta models write", () => {
    expect(isMetaWriter("muse-spark-1.3")).toBe(true);
    expect(isMetaWriter("muse-image-1.0")).toBe(false);
  });
});
