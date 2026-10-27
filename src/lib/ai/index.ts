import "server-only";
import { z } from "zod";
import { shouldTranslate } from "../book/speech";
import type { SourceVoice, Turn } from "../book/types";
import { getConfig } from "../config";
import { languageByCode } from "../languages";
import { SAMPLE_LINES, sampleLine } from "./lines";
import { completeJson, transcribeFile } from "./meta";
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

export async function transcribeVoice(input: {
  audio: Buffer;
  language: string;
  keywords: string[];
  durationMs: number;
  clientTranscript: string | null;
  seed: string;
  startWord: string;
}): Promise<SpeechResult> {
  const cfg = getConfig();
  if (cfg.aiMode === "live") {
    const heard = await transcribeFile({
      audio: input.audio,
      languageName: languageByCode(input.language).muse,
      keywords: [input.startWord, ...input.keywords].filter(Boolean),
    });
    const originalText = heard.transcript.trim();
    const durationMs = heard.audioDurationMs || input.durationMs;
    let englishText = originalText;
    let translated = false;
    let usage = emptyUsage;
    if (shouldTranslate(input.language, originalText) && originalText) {
      const translatedResult = await translateBatch(
        [{ id: "one", language: input.language, text: originalText }],
        input.seed,
      );
      englishText = translatedResult.translations[0]?.english || originalText;
      translated = englishText !== originalText;
      usage = translatedResult.usage;
    }
    return {
      originalText,
      englishText,
      translated,
      turns: heard.turns.length > 0 ? heard.turns : turnsFor(input.startWord, originalText, durationMs),
      durationMs,
      provider: "meta",
      model: heard.model,
      audioMs: durationMs,
      usage,
    };
  }

  const client = input.clientTranscript?.trim() ?? "";
  if (client) {
    const needs = shouldTranslate(input.language, client);
    const known = knownEnglish(client);
    const durationMs = Math.max(input.durationMs, 4000);
    return {
      originalText: client,
      englishText: needs ? known ?? client : client,
      translated: Boolean(needs && known),
      turns: turnsFor(input.startWord, client, durationMs),
      durationMs,
      provider: "mock",
      model: "demo-transcript",
      audioMs: 0,
      usage: emptyUsage,
    };
  }

  const line = sampleLine(input.language, input.seed);
  const needs = shouldTranslate(input.language, line.original);
  const durationMs = Math.max(input.durationMs, 6000);
  return {
    originalText: `${input.startWord}. ${line.original}`,
    englishText: needs ? line.english : line.original,
    translated: needs,
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
  const cfg = getConfig();
  if (cfg.aiMode === "mock") {
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
