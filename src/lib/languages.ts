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
  return LANGUAGES.find((language) => language.code === code) ?? LANGUAGES[0];
}
