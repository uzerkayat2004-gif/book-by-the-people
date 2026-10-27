import { describe, expect, it } from "vitest";
import { LANGUAGES } from "./languages";
import {
  ENGLISH_START_WORDS,
  everyLanguageHasStartWords,
  missingStartWordMessage,
  pickStartWord,
  startWordPack,
} from "./start-words";
import { spokenStartWord } from "./book/speech";

describe("start word list", () => {
  it("is a long list and includes the words people were shown as examples", () => {
    expect(ENGLISH_START_WORDS.length).toBeGreaterThanOrEqual(36);
    expect(ENGLISH_START_WORDS).toEqual(expect.arrayContaining(["friend", "bridge", "planet"]));
  });

  it("has a translation for every language, one per English word", () => {
    expect(everyLanguageHasStartWords()).toBe(true);
    for (const language of LANGUAGES) {
      const pack = startWordPack(language.code);
      expect(pack).toHaveLength(ENGLISH_START_WORDS.length);
      for (const word of pack) expect(word.trim().length).toBeGreaterThan(0);
    }
  });

  it("shows the word in the chosen language", () => {
    const bridge = ENGLISH_START_WORDS.indexOf("bridge");
    expect(pickStartWord("en", bridge)).toEqual({ word: "bridge", english: "bridge" });
    expect(pickStartWord("es", bridge)).toEqual({ word: "puente", english: "bridge" });
    expect(pickStartWord("fr", bridge)).toEqual({ word: "pont", english: "bridge" });
    expect(pickStartWord("hi", bridge).word).toBe("पुल");
    expect(pickStartWord("ja", ENGLISH_START_WORDS.indexOf("planet")).word).toBe("惑星");
    expect(pickStartWord("hinglish", bridge).word).toBe("bridge");
  });

  it("picks different words as the seed changes", () => {
    const words = new Set(Array.from({ length: 12 }, (_, index) => pickStartWord("en", index * 3).word));
    expect(words.size).toBeGreaterThan(4);
  });

  it("asks for another take and does not pretend the recording was kept", () => {
    const message = missingStartWordMessage("puente", "Spanish");
    expect(message).toMatch(/nothing was saved/i);
    expect(message).toMatch(/record again/i);
    expect(message).toContain("puente");
    expect(message).toContain("Spanish");
  });

  it("only accepts the translated word at the start", () => {
    expect(spokenStartWord("Puente. Luego cuento lo que pienso de verdad.", "puente")).toBe(true);
    expect(spokenStartWord("Bridge. Then I answer in English instead.", "puente")).toBe(false);
    expect(
      spokenStartWord("Yo empiezo a contar una historia larga y solo despues digo puente al final.", "puente"),
    ).toBe(false);
  });
});
