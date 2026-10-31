import { describe, expect, it } from "vitest";
import { EN, fill, hasBuiltInUi, langAttrs, languageName, uiFor } from "./index";
import { BOOK_LANGUAGES, bookLanguage, isRtl } from "../languages";
import { SPEAK_LANGUAGES } from "../speak-languages";
import { shouldTranslate } from "../book/speech";
import { contentWords } from "../book/checks";

describe("book languages", () => {
  it("puts English, Hindi and Japanese near the top", () => {
    const top = BOOK_LANGUAGES.slice(0, 6).map((item) => item.code);
    expect(top).toEqual(expect.arrayContaining(["en", "hi", "ja"]));
    expect(SPEAK_LANGUAGES.slice(0, 6).map((item) => item.code)).toEqual(expect.arrayContaining(["en", "hi", "ja"]));
  });

  it("falls back to English for an unknown code", () => {
    expect(bookLanguage("xx").code).toBe("en");
    expect(isRtl("ar")).toBe(true);
    expect(langAttrs("ar").dir).toBe("rtl");
    expect(langAttrs("ja")).toEqual({ lang: "ja", dir: "ltr" });
  });
});

describe("page words", () => {
  it("has built-in words for the main languages", () => {
    for (const code of ["en", "hi", "ja", "es", "fr", "de", "pt"]) expect(hasBuiltInUi(code)).toBe(true);
    expect(uiFor("ja").addYourVoice).not.toBe(EN.addYourVoice);
    expect(uiFor("hi").addYourVoice).not.toBe(EN.addYourVoice);
  });

  it("uses a stored machine translation, and only for its own language", () => {
    const stored = JSON.stringify({ language: "ml", strings: { addYourVoice: "നിങ്ങളുടെ ശബ്ദം ചേർക്കൂ", nope: 1 } });
    expect(uiFor("ml", stored).addYourVoice).toBe("നിങ്ങളുടെ ശബ്ദം ചേർക്കൂ");
    expect(uiFor("ta", stored).addYourVoice).toBe(EN.addYourVoice);
    expect(uiFor("ml", "not json")).toBe(EN);
  });

  it("fills holes and names languages", () => {
    expect(fill("Hi {name}, {n}", { name: "A", n: 2 })).toBe("Hi A, 2");
    expect(languageName("ja", "en")).toMatch(/Japanese/);
  });
});

describe("turning voices into the book's language", () => {
  it("translates anything not already in the book language", () => {
    expect(shouldTranslate("hi", "यह मुझे आलसी बनाता है", "ja")).toBe(true);
    expect(shouldTranslate("ja", "便利だけど考えなくなる", "ja")).toBe(false);
    expect(shouldTranslate("en", "It makes me lazy", "hi")).toBe(true);
  });

  it("reads words in any script", () => {
    expect(contentWords("यह मुझे आलसी बनाता है")).toContain("आलसी");
    expect(contentWords("Привет, как дела сегодня")).toContain("сегодня");
  });
});
