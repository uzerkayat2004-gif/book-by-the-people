export type LanguageOption = {
  code: string;
  name: string;
  muse: string;
};

/** Muse Voice Transcribe's 25 evaluated languages, plus Hinglish as an explicit skip-translation choice. */
export const LANGUAGES: LanguageOption[] = [
  { code: "en", name: "English", muse: "English" },
  { code: "hinglish", name: "Hinglish", muse: "Hindi" },
  { code: "ar", name: "Arabic", muse: "Arabic" },
  { code: "bn", name: "Bengali", muse: "Bengali" },
  { code: "nl", name: "Dutch", muse: "Dutch" },
  { code: "fr", name: "French", muse: "French" },
  { code: "de", name: "German", muse: "German" },
  { code: "he", name: "Hebrew", muse: "Hebrew" },
  { code: "hi", name: "Hindi", muse: "Hindi" },
  { code: "id", name: "Indonesian", muse: "Indonesian" },
  { code: "it", name: "Italian", muse: "Italian" },
  { code: "ja", name: "Japanese", muse: "Japanese" },
  { code: "kn", name: "Kannada", muse: "Kannada" },
  { code: "ko", name: "Korean", muse: "Korean" },
  { code: "ms", name: "Malay", muse: "Malay" },
  { code: "zh", name: "Mandarin Chinese", muse: "Mandarin Chinese" },
  { code: "mr", name: "Marathi", muse: "Marathi" },
  { code: "pl", name: "Polish", muse: "Polish" },
  { code: "pt", name: "Portuguese", muse: "Portuguese" },
  { code: "es", name: "Spanish", muse: "Spanish" },
  { code: "tl", name: "Tagalog", muse: "Tagalog" },
  { code: "ta", name: "Tamil", muse: "Tamil" },
  { code: "te", name: "Telugu", muse: "Telugu" },
  { code: "th", name: "Thai", muse: "Thai" },
  { code: "tr", name: "Turkish", muse: "Turkish" },
  { code: "vi", name: "Vietnamese", muse: "Vietnamese" },
];

export function languageByCode(code: string): LanguageOption {
  const known = LANGUAGES.find((language) => language.code === code);
  if (known) return known;
  const book = BOOK_LANGUAGES.find((language) => language.code === code);
  return book ? { code: book.code, name: book.name, muse: book.name } : LANGUAGES[0];
}

/**
 * Every language a book can be written in, and a contributor can speak or write in.
 * All of them are understood by the in-browser speech model (Whisper). The first block is
 * the most used; the rest follow. `native` is how the language names itself.
 */
export type BookLanguage = { code: string; name: string; native: string; rtl?: boolean };

export const BOOK_LANGUAGES: BookLanguage[] = [
  { code: "en", name: "English", native: "English" },
  { code: "hi", name: "Hindi", native: "हिन्दी" },
  { code: "ja", name: "Japanese", native: "日本語" },
  { code: "es", name: "Spanish", native: "Español" },
  { code: "fr", name: "French", native: "Français" },
  { code: "de", name: "German", native: "Deutsch" },
  { code: "pt", name: "Portuguese", native: "Português" },
  { code: "it", name: "Italian", native: "Italiano" },
  { code: "nl", name: "Dutch", native: "Nederlands" },
  { code: "pl", name: "Polish", native: "Polski" },
  { code: "sv", name: "Swedish", native: "Svenska" },
  { code: "ru", name: "Russian", native: "Русский" },
  { code: "uk", name: "Ukrainian", native: "Українська" },
  { code: "zh", name: "Chinese", native: "中文" },
  { code: "ko", name: "Korean", native: "한국어" },
  { code: "ar", name: "Arabic", native: "العربية", rtl: true },
  { code: "bn", name: "Bengali", native: "বাংলা" },
  { code: "ur", name: "Urdu", native: "اردو", rtl: true },
  { code: "ta", name: "Tamil", native: "தமிழ்" },
  { code: "te", name: "Telugu", native: "తెలుగు" },
  { code: "mr", name: "Marathi", native: "मराठी" },
  { code: "gu", name: "Gujarati", native: "ગુજરાતી" },
  { code: "kn", name: "Kannada", native: "ಕನ್ನಡ" },
  { code: "ml", name: "Malayalam", native: "മലയാളം" },
  { code: "pa", name: "Punjabi", native: "ਪੰਜਾਬੀ" },
  { code: "ne", name: "Nepali", native: "नेपाली" },
  { code: "id", name: "Indonesian", native: "Bahasa Indonesia" },
  { code: "ms", name: "Malay", native: "Bahasa Melayu" },
  { code: "tl", name: "Filipino", native: "Filipino" },
  { code: "vi", name: "Vietnamese", native: "Tiếng Việt" },
  { code: "th", name: "Thai", native: "ไทย" },
  { code: "tr", name: "Turkish", native: "Türkçe" },
  { code: "fa", name: "Persian", native: "فارسی", rtl: true },
  { code: "he", name: "Hebrew", native: "עברית", rtl: true },
  { code: "el", name: "Greek", native: "Ελληνικά" },
  { code: "cs", name: "Czech", native: "Čeština" },
  { code: "ro", name: "Romanian", native: "Română" },
  { code: "hu", name: "Hungarian", native: "Magyar" },
  { code: "da", name: "Danish", native: "Dansk" },
  { code: "fi", name: "Finnish", native: "Suomi" },
  { code: "no", name: "Norwegian", native: "Norsk" },
  { code: "sk", name: "Slovak", native: "Slovenčina" },
  { code: "bg", name: "Bulgarian", native: "Български" },
  { code: "hr", name: "Croatian", native: "Hrvatski" },
  { code: "sr", name: "Serbian", native: "Српски" },
  { code: "ca", name: "Catalan", native: "Català" },
  { code: "sw", name: "Swahili", native: "Kiswahili" },
  { code: "af", name: "Afrikaans", native: "Afrikaans" },
];

export const BOOK_LANGUAGE_CODES = new Set(BOOK_LANGUAGES.map((language) => language.code));

/** A book or contributor language by code (falls back to English). Hinglish is an old choice: Hindi words in Latin letters. */
export function bookLanguage(code: string | null | undefined): BookLanguage {
  const clean = (code ?? "").toLowerCase();
  if (clean === "hinglish") return { code: "hinglish", name: "Hinglish", native: "Hinglish" };
  return BOOK_LANGUAGES.find((language) => language.code === clean) ?? BOOK_LANGUAGES[0];
}

export function languageLabel(code: string): string {
  const language = bookLanguage(code);
  return language.native === language.name ? language.name : `${language.native} · ${language.name}`;
}

export function isRtl(code: string): boolean {
  return Boolean(bookLanguage(code).rtl);
}
