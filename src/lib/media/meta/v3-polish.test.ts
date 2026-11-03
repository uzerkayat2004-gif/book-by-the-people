import { describe, expect, it } from "vitest";
import { captionChunks, captionLines } from "./storyboard";
import { phrasePieces } from "./text";
import { phrasesFor, PHRASE_LANGUAGES } from "./phrases";
import { polishVoice, voicedRms } from "./sound";
import { mosaicLayout } from "./film-client";
import { MMS_LANGUAGES } from "./catalog";

describe("phrasePieces", () => {
  it("breathes at commas but keeps short bits together", () => {
    expect(phrasePieces("A classroom door opens, and a life turns a little.")).toEqual(["A classroom door opens,", "and a life turns a little."]);
    expect(phrasePieces("Yes, she said.")).toEqual(["Yes, she said."]);
    expect(phrasePieces("They wait through the stumble and the silence — and refuse to hurry.")).toHaveLength(2);
  });
});

describe("captions", () => {
  it("break after sentences and clauses, not mid-phrase", () => {
    const chunks = captionChunks({ startMs: 0, endMs: 9000, text: "A good teacher stays. They wait through the stumble and the silence, and refuse to hurry a child along, even when the bell rings and everyone else has gone home." });
    expect(chunks[0].text).toBe("A good teacher stays.");
    expect(chunks.every((c) => c.text.length <= 84)).toBe(true);
    expect(chunks.slice(0, -1).every((c) => /[.,!?;:]$/.test(c.text))).toBe(true);
    expect(chunks.at(-1)!.endMs).toBe(9000);
  });
  it("split into at most two even lines, at a comma when there is one", () => {
    const measure = (s: string) => s.length * 10;
    expect(captionLines("short line", measure, 500)).toEqual(["short line"]);
    const lines = captionLines("My chemistry teacher lit his own tie on fire, just to show us combustion", measure, 500);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/fire,$/);
  });
});

describe("phrases", () => {
  it("covers every Meta voice language", () => {
    for (const lang of Object.keys(MMS_LANGUAGES)) expect(PHRASE_LANGUAGES).toContain(lang);
  });
  it("says the counts exactly", () => {
    expect(phrasesFor("en").intro(92, 10)).toBe("A book written by 92 people from 10 countries.");
    expect(phrasesFor("en").voices(1500)).toBe("1,500 voices");
    expect(phrasesFor("es").named("Ana", "Lima")).toBe("Como dijo Ana, de Lima: ");
    expect(phrasesFor("ru").countries(3)).toBe("из 3 стран");
    expect(phrasesFor("ro").intro(92, 10)).toBe("O carte scrisă de 92 de oameni din 10 țări.");
    expect(phrasesFor("xx")).toBe(phrasesFor("en"));
  });
});

describe("polishVoice", () => {
  it("keeps the loudness and stays below clipping", () => {
    const rate = 16000;
    const audio = new Float32Array(rate * 2).map((_, i) => 0.25 * Math.sin((2 * Math.PI * 180 * i) / rate) * (i % 4000 < 3000 ? 1 : 0.1));
    const out = polishVoice(audio, rate);
    expect(Math.abs(voicedRms(out, rate) / voicedRms(audio, rate) - 1.19)).toBeLessThan(0.25);
    expect(Math.max(...out.map(Math.abs))).toBeLessThanOrEqual(0.851);
  });
});

describe("mosaicLayout", () => {
  it("shows every country once at least and fills the frame, from 1 to 250 flags", () => {
    for (const n of [1, 2, 10, 45, 120, 250]) {
      const layout = mosaicLayout(n, 1510, 850);
      const seen = new Set(layout.tiles.map((t) => t.flag));
      expect(seen.size).toBe(n);
      expect(layout.tiles.length).toBeGreaterThanOrEqual(Math.min(n, 56));
      expect(layout.tileW).toBeGreaterThan(20);
    }
  });
});
