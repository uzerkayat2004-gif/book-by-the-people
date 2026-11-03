import type { BookDocument } from "@/lib/book/types";
import { stripPeopleCounts } from "@/lib/book/checks";
import type { ChapterScript, Pause, Segment } from "./text";

/** Unit 0 is the opening (title, question, preface); unit n is chapter n. */
export function narrationUnits(document: BookDocument): number {
  return document.chapters.length + 1;
}

const clean = (part: string | null | undefined) => stripPeopleCounts((part ?? "").replace(/\s+/g, " ").trim());

/** What the narrator works from for one unit, as plain labelled text. */
export function unitSource(document: BookDocument, unit: number): { title: string; text: string } {
  if (unit === 0) {
    return { title: document.title, text: [`Title: ${clean(document.title)}`, `Question: ${clean(document.question)}`, `Preface: ${clean(document.preface)}`].join("\n") };
  }
  const chapter = document.chapters[unit - 1];
  const lines = [`Chapter ${unit}: ${clean(chapter.title)}`, `Narrative: ${clean(chapter.narrative)}`];
  for (const quote of chapter.quotes ?? []) {
    if (quote.hidden) continue;
    const text = clean(quote.englishText);
    if (text) lines.push(`Quote from ${clean(quote.speakerName) || "someone"}: "${text}"`);
  }
  if (chapter.agreement) lines.push(`Where people agree: ${clean(chapter.agreement)}`);
  if (chapter.disagreement) lines.push(`Where people differ: ${clean(chapter.disagreement)}`);
  return { title: clean(chapter.title), text: lines.join("\n") };
}

export const NARRATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "segments"],
  properties: {
    title: { type: "string" },
    segments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "pause"],
        properties: { text: { type: "string" }, pause: { type: "string", enum: ["none", "short", "long"] } },
      },
    },
  },
};

export function narrationPrompt(input: { unit: number; total: number; languageName: string; bookTitle: string; source: string }) {
  const system = [
    `You are the narrator of an audiobook made from real people's voices. Write the spoken narration in ${input.languageName}.`,
    "Rules:",
    "- Keep every quote's meaning and words; introduce each one naturally, e.g. \"Asha said:\" then the quote.",
    "- Short spoken sentences of at most 25 words. Write numbers, symbols and abbreviations as words.",
    "- No markdown, no emoji, no brackets, no stage directions, no sound effects.",
    "- Do not invent facts, names or places. Do not say how many people took part.",
    "- Each segment is one or a few sentences. Set pause to \"long\" at the end of a section, \"short\" between ideas, otherwise \"none\".",
    input.unit === 0
      ? "- This is the opening: welcome the listener, say the title and the question, then read the preface."
      : `- This is chapter ${input.unit} of ${input.total - 1}. Start by saying the chapter number and title.`,
    input.unit === input.total - 1 ? "- This is the last chapter: end with one short closing line thanking everyone who shared their voice." : "",
  ]
    .filter(Boolean)
    .join("\n");
  const user = `Book: ${input.bookTitle}\n\n${input.source}`;
  return { system, user };
}

const PAUSES: Pause[] = ["none", "short", "long"];

/** Reads the model's JSON. Throws if it is unusable, so the caller can retry or use the plain script. */
export function parseNarration(raw: unknown): ChapterScript {
  const data = raw as { title?: unknown; segments?: unknown };
  if (!data || !Array.isArray(data.segments)) throw new Error("The narration came back without segments.");
  const segments: Segment[] = [];
  for (const item of data.segments as { text?: unknown; pause?: unknown }[]) {
    const text = typeof item?.text === "string" ? stripPeopleCounts(item.text.replace(/[*_#`[\]{}<>]/g, "").replace(/\s+/g, " ").trim()) : "";
    if (!text) continue;
    segments.push({ text, pause: PAUSES.includes(item.pause as Pause) ? (item.pause as Pause) : "short" });
  }
  if (!segments.length) throw new Error("The narration came back empty.");
  return { title: typeof data.title === "string" ? data.title.trim() : "", segments };
}

/** The plain script for one unit, used when no model can write (or it keeps failing). */
export function plainNarration(document: BookDocument, unit: number): ChapterScript {
  const sentence = (text: string) => (/[.!?…:।]["”’)]?$/u.test(text) ? text : `${text}.`);
  const segments: Segment[] = [];
  const add = (text: string, pause: Pause = "short") => {
    const value = clean(text);
    if (value) segments.push({ text: sentence(value), pause });
  };
  if (unit === 0) {
    add(document.title, "long");
    add(document.question, "long");
    add(document.preface, "long");
    return { title: clean(document.title), segments };
  }
  const chapter = document.chapters[unit - 1];
  add(`Chapter ${unit}. ${chapter.title}`, "long");
  add(chapter.narrative);
  for (const quote of chapter.quotes ?? []) {
    if (quote.hidden) continue;
    const text = clean(quote.englishText);
    if (!text) continue;
    const name = clean(quote.speakerName);
    add(name ? `${name} said: ${text}` : text);
  }
  add(chapter.agreement ?? "");
  add(chapter.disagreement ?? "", "long");
  if (segments.length) segments[segments.length - 1].pause = "long";
  return { title: clean(chapter.title), segments };
}
