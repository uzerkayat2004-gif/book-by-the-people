import "server-only";
import { z } from "zod";
import { shouldTranslate } from "../book/speech";
import type { SourceVoice, Turn } from "../book/types";
import { languageByCode } from "../languages";
import { SAMPLE_LINES, sampleLine } from "./lines";
import { completeJson, transcribeFile } from "./meta";
import { transcriberLive, writerLive } from "./providers";
import { BOOK_JSON_SCHEMA, TRANSLATION_JSON_SCHEMA, bookMessages, translationMessages } from "./prompt";
import type { TokenUsage } from "./spend";

export type SpeechResult = {
  originalText: string;
  englishText: string;
  translated: boolean;
  turns: Turn[];
  durationMs: number;
  provider: string;
  model: string;
  audioMs: number;
  usage: TokenUsage;
};

const modelBookSchema = z.object({
  preface: z.string(),
  chapters: z.array(
    z.object({
      title: z.string(),
      theme: z.string(),
      narrative: z.string(),
      agreement: z.string().optional().default(""),
      disagreement: z.string().optional().default(""),
      quotes: z.array(z.object({ voiceId: z.string(), verbatim: z.string() })),
    }),
  ),
});

const translationSchema = z.object({
  translations: z.array(z.object({ id: z.string(), english: z.string() })),
});

const emptyUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };

export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("The model did not return JSON.");
  }
}

function turnsFor(startWord: string, sentence: string, durationMs: number): Turn[] {
  const duration = Math.max(durationMs, 2000);
  const cut = Math.min(900, Math.round(duration * 0.18));
  return [
    { turnId: 1, startMs: 0, endMs: cut, transcript: startWord ? `${startWord}.` : sentence },
    { turnId: 2, startMs: cut, endMs: duration, transcript: sentence },
  ];
}

function knownEnglish(transcript: string): string | null {
  const lower = transcript.toLowerCase();
  for (const lines of Object.values(SAMPLE_LINES)) {
    for (const line of lines) {
      if (lower.includes(line.original.toLowerCase())) return line.english;
    }
  }
  return null;
}

export const NO_TRANSCRIPT =
  "This browser gave no transcript and no speech model is set up. Record in Chrome or Edge, or add a Meta key for speech in Book settings.";

export async function transcribeVoice(input: {
  audio: Buffer;
  language: string;
  keywords: string[];
  durationMs: number;
  clientTranscript: string | null;
  seed: string;
  startWord: string;
  bookId?: string;
  /** The book's usage limit is reached: never call an AI model, only use the browser's transcript. */
  noAi?: boolean;
}): Promise<SpeechResult> {
  if (input.noAi && !input.clientTranscript?.trim()) {
    throw new Error("This book's AI usage limit is reached, and this browser gave no transcript.");
  }
  if (!input.noAi && (await transcriberLive(input.bookId))) {
    const heard = await transcribeFile({
      audio: input.audio,
      languageName: languageByCode(input.language).muse,
      languageCode: input.language.split("-")[0],
      keywords: [input.startWord, ...input.keywords].filter(Boolean),
      bookId: input.bookId,
    });
    const originalText = heard.transcript.trim();
    const durationMs = heard.audioDurationMs || input.durationMs;
    // Translation runs later in the pipeline, after the start-word check.
    const englishText = originalText;
    const translated = false;
    const usage = emptyUsage;
    return {
      originalText,
      englishText,
      translated,
      turns: heard.turns.length > 0 ? heard.turns : turnsFor(input.startWord, originalText, durationMs),
      durationMs,
      provider: heard.provider,
      model: heard.model,
      audioMs: durationMs,
      usage,
    };
  }

  const client = input.clientTranscript?.trim() ?? "";
  if (client) {
    const durationMs = Math.max(input.durationMs, 4000);
    return {
      originalText: client,
      englishText: client,
      translated: false,
      turns: turnsFor(input.startWord, client, durationMs),
      durationMs,
      provider: "mock",
      model: "demo-transcript",
      audioMs: 0,
      usage: emptyUsage,
    };
  }

  // A sample line stands in only in full demo mode (no AI model anywhere). With a real
  // writing model, an untranscribed voice must never become made-up words in the book.
  if (await writerLive(input.bookId)) {
    throw new Error(NO_TRANSCRIPT);
  }
  const line = sampleLine(input.language, input.seed);
  const durationMs = Math.max(input.durationMs, 6000);
  return {
    originalText: `${input.startWord}. ${line.original}`,
    englishText: `${input.startWord}. ${line.original}`,
    translated: false,
    turns: turnsFor(input.startWord, line.original, durationMs),
    durationMs,
    provider: "mock",
    model: "demo-transcript",
    audioMs: 0,
    usage: emptyUsage,
  };
}

export async function translateBatch(
  items: { id: string; language: string; text: string }[],
  bookId: string,
): Promise<{ translations: { id: string; english: string }[]; usage: TokenUsage; provider: string; model: string }> {
  if (!(await writerLive(bookId))) {
    return {
      translations: items.map((item) => ({
        id: item.id,
        english: shouldTranslate(item.language, item.text) ? knownEnglish(item.text) ?? item.text : item.text,
      })),
      usage: emptyUsage,
      provider: "mock",
      model: "demo-translate",
    };
  }

  const pending = items.filter((item) => shouldTranslate(item.language, item.text));
  if (pending.length === 0) {
    return {
      translations: items.map((item) => ({ id: item.id, english: item.text })),
      usage: emptyUsage,
      provider: "none",
      model: "",
    };
  }
  const messages = translationMessages(pending);
  const result = await completeJson({
    ...messages,
    schemaName: "translations",
    schema: TRANSLATION_JSON_SCHEMA,
    bookId,
  });
  const parsed = translationSchema.parse(extractJson(result.content));
  const byId = new Map(parsed.translations.map((item) => [item.id, item.english]));
  return {
    translations: items.map((item) => ({ id: item.id, english: byId.get(item.id) || item.text })),
    usage: result.usage,
    provider: result.provider,
    model: result.model,
  };
}

export async function writeBook(input: {
  title: string;
  question: string;
  bookType: string;
  voices: SourceVoice[];
  bookId: string;
}): Promise<{ model: z.infer<typeof modelBookSchema>; provider: string; modelId: string; usage: TokenUsage }> {
  const messages = bookMessages(input);
  const result = await completeJson({
    ...messages,
    schemaName: "book",
    schema: BOOK_JSON_SCHEMA,
    bookId: input.bookId,
  });
  return {
    model: modelBookSchema.parse(extractJson(result.content)),
    provider: result.provider,
    modelId: result.model,
    usage: result.usage,
  };
}

const reviewSchema = z.object({
  onTopic: z.boolean(),
  impersonation: z.boolean(),
  theme: z.string(),
  note: z.string().optional().default(""),
});

export const REVIEW_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["onTopic", "impersonation", "theme", "note"],
  properties: {
    onTopic: { type: "boolean" },
    impersonation: { type: "boolean" },
    theme: { type: "string" },
    note: { type: "string" },
  },
};

/** Live-mode voice check with muse-spark. Only called when AI_MODE is live. */
export async function reviewWithModel(input: {
  bookId: string;
  question: string;
  name: string;
  text: string;
  kind: "voice" | "sourced_quote";
}) {
  const result = await completeJson({
    system:
      "You check one contribution to a crowd-written book. Answer in JSON only. onTopic: does it actually answer the question (any stance counts)? impersonation: does the contributor name claim to be a famous public figure while this is an ordinary recorded voice (always false for sourced quotes)? theme: a 2-5 word chapter theme drawn from the contribution's own words, sentence case. note: one short sentence for the creator if anything is wrong, else empty.",
    user: JSON.stringify({ question: input.question, name: input.name, kind: input.kind, text: input.text.slice(0, 4000) }),
    schemaName: "voice_review",
    schema: REVIEW_JSON_SCHEMA,
    bookId: input.bookId,
  });
  return {
    review: reviewSchema.parse(extractJson(result.content)),
    usage: result.usage,
    provider: result.provider,
    model: result.model,
  };
}
