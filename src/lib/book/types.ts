export type BookType = "SOLO" | "INVITED" | "OPEN" | "FAMOUS";

export type Turn = {
  turnId: number;
  startMs: number;
  endMs: number;
  transcript: string;
};

export type SourceVoice = {
  id: string;
  contributorName: string;
  language: string;
  countryCode: string | null;
  originalText: string;
  englishText: string;
  translated: boolean;
  /** Which language englishText is in ("" = English). */
  bookLanguage?: string;
  turns: Turn[];
  durationMs: number;
  createdAt: number;
  kind: "voice" | "sourced_quote";
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceDate?: string | null;
  hidden: boolean;
  status: string;
  startWord: string;
  hasAudio: boolean;
  /** Region or city the person gave (optional). */
  region?: string;
  /** Verified notable: a sourced public quote, or the creator marked this person as notable in Studio. */
  notable?: boolean;
  /** The name matches a public figure but nobody verified it: never present it as that person. */
  nameUnverified?: boolean;
};

export type QuoteSpan = {
  id: string;
  voiceId: string;
  speakerName: string;
  language: string;
  countryCode: string | null;
  originalText: string;
  englishText: string;
  startMs: number;
  endMs: number;
  kind: "voice" | "sourced_quote";
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceDate?: string | null;
  hidden: boolean;
  hasAudio: boolean;
};

/** One piece of a flowing chapter, in reading order. */
export type Block =
  | { kind: "p"; text: string; cluster?: string }
  | { kind: "quote"; quoteId: string }
  /** A quiet section break inside a continuous piece (no heading is shown). */
  | { kind: "break"; title?: string };

export type Chapter = {
  id: string;
  title: string;
  theme: string;
  narrative: string;
  agreement: string | null;
  disagreement: string | null;
  quotes: QuoteSpan[];
  /** Feature books: paragraphs and standout quotes in reading order. narrative is the same paragraphs joined. */
  blocks?: Block[];
  /** How many voices this chapter speaks for. */
  voices?: number;
};

export type OutlineCluster = {
  id: string;
  label: string;
  summary: string;
  count: number;
  share: number;
  countries: { code: string; count: number }[];
  phrases: { voiceId: string; text: string }[];
  voiceIds: string[];
};

export type OutlineStandout = { voiceId: string; name: string; place: string; text: string; why: string; notable: boolean };

export type OutlineSection = {
  id: string;
  title: string;
  role: "hook" | "build" | "contrast" | "resolution" | "closing" | string;
  purpose: string;
  clusterIds: string[];
  standoutIds: string[];
};

/** The saved structure plan. The book, the audiobook and the film all follow it. */
export type BookOutline = {
  v: 1;
  form: "chapters" | "continuous";
  total: number;
  countries: number;
  arc: string;
  clusters: OutlineCluster[];
  standouts: OutlineStandout[];
  sections: OutlineSection[];
  steps: string[];
};

export type BookDocument = {
  /** The language the book is written in (missing = English). */
  language?: string;
  title: string;
  question: string;
  bookType: BookType | string;
  preface: string;
  chapters: Chapter[];
  /** Feature books: "continuous" is one flowing piece with no chapter headings. */
  form?: "chapters" | "continuous";
  /** One-line hook shown under the title. */
  standfirst?: string;
  outline?: BookOutline;
  provider: string;
  model: string;
  generatedAt: string;
};

export type ChapterPlan = {
  voiceIds: string[];
  theme: string;
};

export type ModelQuote = { voiceId: string; verbatim: string };

export type ModelChapter = {
  title: string;
  theme: string;
  narrative: string;
  agreement?: string;
  disagreement?: string;
  quotes: ModelQuote[];
};

export type ModelBook = {
  preface: string;
  chapters: ModelChapter[];
};

export type EditorChapter = {
  id: string;
  title: string;
  narrative: string;
  hiddenQuoteIds: string[];
};

export type EditorEdits = {
  preface: string;
  chapters: EditorChapter[];
};
