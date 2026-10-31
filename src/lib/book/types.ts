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

export type Chapter = {
  id: string;
  title: string;
  theme: string;
  narrative: string;
  agreement: string | null;
  disagreement: string | null;
  quotes: QuoteSpan[];
};

export type BookDocument = {
  /** The language the book is written in (missing = English). */
  language?: string;
  title: string;
  question: string;
  bookType: BookType | string;
  preface: string;
  chapters: Chapter[];
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
