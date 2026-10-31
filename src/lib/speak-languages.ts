import { BOOK_LANGUAGES } from "./languages";

/** Languages offered for speaking or writing, most used first. Label: native name, then English. */
export const SPEAK_LANGUAGES: { code: string; label: string }[] = BOOK_LANGUAGES.map((language) => ({
  code: language.code,
  label: language.native === language.name ? language.name : `${language.native} ${language.name}`,
}));
