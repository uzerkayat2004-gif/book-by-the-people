/** The video book's storyboard: which picture or quote card is on screen while each part of the narration plays. Pure helpers. */
import type { BookDocument } from "@/lib/book/types";
import { stripPeopleCounts } from "@/lib/book/checks";
import type { ChapterScript } from "./text";

export type SceneKind = "picture" | "quote" | "card";
/** One scene, starting at a narration segment of its chapter. */
export type Scene = { kind: SceneKind; segment: number; prompt?: string; quote?: number };
export type Storyboard = { scenes: Scene[] };
export type QuoteRef = { text: string; speaker: string; country: string | null };

export const MAX_SCENES_PER_UNIT = 5;
export const MAX_PICTURES_PER_UNIT = 3;

const clean = (part: string | null | undefined) => stripPeopleCounts((part ?? "").replace(/\s+/g, " ").trim());

/** The quotes a chapter can show as cards (hidden ones never appear). Unit 0 (the opening) has none. */
export function unitQuotes(document: BookDocument, unit: number): QuoteRef[] {
  if (unit === 0) return [];
  const chapter = document.chapters[unit - 1];
  return (chapter?.quotes ?? [])
    .filter((quote) => !quote.hidden && clean(quote.englishText || quote.originalText))
    .map((quote) => ({ text: clean(quote.englishText || quote.originalText), speaker: clean(quote.speakerName) || "Someone", country: quote.countryCode ?? null }));
}

export const STORYBOARD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scenes"],
  properties: {
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "segment", "prompt", "quote"],
        properties: {
          kind: { type: "string", enum: ["picture", "quote"] },
          segment: { type: "integer" },
          prompt: { type: "string" },
          quote: { type: "integer" },
        },
      },
    },
  },
};

/** The look every picture shares, so a film feels like one piece. */
export const PICTURE_STYLE =
  "Cinematic editorial illustration, painterly, soft film grain, warm low light with deep ember red and charcoal tones, 16:9 wide shot, calm and human. No text, no letters, no logos, no watermarks, no recognisable real people.";

export function storyboardPrompt(input: { unit: number; total: number; bookTitle: string; question: string; script: ChapterScript; quotes: QuoteRef[]; pictures: boolean }) {
  const system = [
    "You are the director of a short documentary film made from a book of real people's voices.",
    "The narration is already recorded. Choose what is on screen while it plays.",
    "Rules:",
    `- Return 1 to ${MAX_SCENES_PER_UNIT} scenes in order. "segment" is the number of the narration segment where the scene starts. The first scene starts at segment 0. Each scene lasts until the next one, so give every scene at least two segments where you can.`,
    input.pictures
      ? `- kind "picture": write "prompt", one vivid sentence describing a picture that fits what is being said (a place, an object, a mood, people seen from behind or far away). At most ${MAX_PICTURES_PER_UNIT} pictures. Never put words, signs, names or real people in a picture.`
      : '- Pictures are off: do not use kind "picture".',
    input.quotes.length
      ? '- kind "quote": show one of the listed quotes as a card while the narration reads it. "quote" is its number. Use each quote at most once, at the segment where it is read.'
      : '- There are no quotes to show in this part: do not use kind "quote".',
    '- Use "" for prompt and -1 for quote when they do not apply.',
    "- Do not invent facts. Do not say or show how many people took part.",
  ].join("\n");
  const lines = [
    `Book: ${input.bookTitle}`,
    `Question: ${input.question}`,
    input.unit === 0 ? "Part: the opening" : `Part: chapter ${input.unit} of ${input.total - 1}`,
    "",
    "Narration segments:",
    ...input.script.segments.map((segment, index) => `${index}. ${segment.text}`),
  ];
  if (input.quotes.length) lines.push("", "Quotes:", ...input.quotes.map((quote, index) => `${index}. ${quote.speaker}: "${quote.text}"`));
  return { system, user: lines.join("\n") };
}

/** Reads the model's storyboard and makes it safe to play: valid segments, in order, real quotes, picture limits. Throws if nothing usable is left. */
export function parseStoryboard(raw: unknown, segments: number, quotes: number, pictures: boolean): Storyboard {
  const data = raw as { scenes?: unknown };
  if (!data || !Array.isArray(data.scenes)) throw new Error("The storyboard came back without scenes.");
  const scenes: Scene[] = [];
  const usedQuotes = new Set<number>();
  let pictureCount = 0;
  for (const item of data.scenes as { kind?: unknown; segment?: unknown; prompt?: unknown; quote?: unknown }[]) {
    const segment = Math.floor(Number(item?.segment));
    if (!Number.isFinite(segment) || segment < 0 || segment >= segments) continue;
    if (scenes.length && segment <= scenes[scenes.length - 1].segment) continue;
    if (item.kind === "quote") {
      const quote = Math.floor(Number(item.quote));
      if (!Number.isFinite(quote) || quote < 0 || quote >= quotes || usedQuotes.has(quote)) continue;
      usedQuotes.add(quote);
      scenes.push({ kind: "quote", segment, quote });
    } else if (item.kind === "picture" && pictures && pictureCount < MAX_PICTURES_PER_UNIT) {
      const prompt = typeof item.prompt === "string" ? item.prompt.replace(/\s+/g, " ").trim().slice(0, 600) : "";
      if (!prompt) continue;
      pictureCount += 1;
      scenes.push({ kind: "picture", segment, prompt });
    }
    if (scenes.length >= MAX_SCENES_PER_UNIT) break;
  }
  if (!scenes.length) throw new Error("The storyboard came back empty.");
  // The first scene always starts with the narration.
  scenes[0] = { ...scenes[0], segment: 0 };
  return { scenes };
}

/** Where a quote is read in the narration (by its first words), or -1. */
export function findQuoteSegment(script: ChapterScript, quote: QuoteRef): number {
  const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const head = words(quote.text).slice(0, 6).join(" ");
  if (!head) return -1;
  return script.segments.findIndex((segment) => words(segment.text).join(" ").includes(head));
}

/** The storyboard without a model: a card or picture to open, then each quote as it is read. */
export function plainStoryboard(input: { unit: number; script: ChapterScript; quotes: QuoteRef[]; pictures: boolean; title: string; theme?: string; question: string }): Storyboard {
  const scenes: Scene[] = [];
  const prompt = input.unit === 0 ? `An evocative scene about the question: ${input.question}` : `An evocative scene about "${input.title}"${input.theme ? `: ${input.theme}` : ""}`;
  scenes.push(input.pictures && input.unit > 0 ? { kind: "picture", segment: 0, prompt } : { kind: "card", segment: 0 });
  if (input.unit === 0 && input.pictures && input.script.segments.length > 2) scenes.push({ kind: "picture", segment: 2, prompt });
  input.quotes.forEach((quote, index) => {
    const segment = findQuoteSegment(input.script, quote);
    if (segment > (scenes[scenes.length - 1]?.segment ?? -1) && scenes.length < MAX_SCENES_PER_UNIT) scenes.push({ kind: "quote", segment, quote: index });
  });
  return { scenes };
}

/** Splits a long caption into lines of at most `max` characters, timed by length. */
export function captionChunks(cue: { startMs: number; endMs: number; text: string }, max = 84): { startMs: number; endMs: number; text: string }[] {
  const words = cue.text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && (line + " " + word).length > max) {
      chunks.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) chunks.push(line);
  const total = chunks.reduce((sum, c) => sum + c.length, 0) || 1;
  let at = cue.startMs;
  return chunks.map((text) => {
    const length = ((cue.endMs - cue.startMs) * text.length) / total;
    const out = { startMs: Math.round(at), endMs: Math.round(at + length), text };
    at += length;
    return out;
  });
}
