import { EN, type Ui, type UiKey } from "./en";
import { HI, JA } from "./hi-ja";
import { DE, ES, FR, IT, PT } from "./eu";
import { AR, KO, RU, ZH } from "./asia";
import { bookLanguage } from "../languages";

export { EN, type Ui, type UiKey };

/** Built-in page words. Other book languages are machine translated once (Book.uiJson) or fall back to English. */
const BUILT_IN: Record<string, Partial<Ui>> = { en: EN, hi: HI, ja: JA, es: ES, fr: FR, de: DE, pt: PT, it: IT, zh: ZH, ko: KO, ru: RU, ar: AR };

export function hasBuiltInUi(code: string): boolean {
  return code in BUILT_IN;
}

/** The page words for a book language. `extra` is the book's stored machine translation (JSON), used when there's no built-in one. */
export function uiFor(code: string | null | undefined, extra?: string | null): Ui {
  const lang = (code || "en").toLowerCase();
  const own = BUILT_IN[lang];
  if (own) return { ...EN, ...own };
  if (extra) {
    try {
      const parsed = JSON.parse(extra) as { language?: string; strings?: Record<string, unknown> };
      if (parsed.language === lang && parsed.strings) {
        const clean: Partial<Ui> = {};
        for (const key of Object.keys(EN) as UiKey[]) {
          const value = parsed.strings[key];
          if (typeof value === "string" && value.trim()) clean[key] = value;
        }
        return { ...EN, ...clean };
      }
    } catch {
      // fall through to English
    }
  }
  return EN;
}

/** Fills {name} style holes. */
export function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole));
}

/** A language's name written in another language, e.g. "Japanese" in Hindi. Falls back to the English name. */
export function languageName(code: string, inLanguage: string): string {
  try {
    const names = new Intl.DisplayNames([inLanguage || "en"], { type: "language" });
    const name = names.of(code === "hinglish" ? "hi" : code);
    if (name && name !== code) return code === "hinglish" ? "Hinglish" : name;
  } catch {
    // older runtimes
  }
  return bookLanguage(code).name;
}

/** HTML lang and direction for a book language. */
export function langAttrs(code: string): { lang: string; dir: "rtl" | "ltr" } {
  return { lang: code || "en", dir: bookLanguage(code).rtl ? "rtl" : "ltr" };
}
