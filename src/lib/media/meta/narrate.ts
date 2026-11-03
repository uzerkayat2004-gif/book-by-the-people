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
  if (chapter.blocks?.length) return { title: document.form === "continuous" ? clean(document.title) : clean(chapter.title), text: "" };
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

/* ---------- Feature books: the narration follows the book's blocks one by one ---------- */

export function isFeatureBook(document: BookDocument): boolean {
  return document.chapters.some((chapter) => chapter.blocks?.length);
}

const sentenceEnd = (text: string) => (/[.!?…:।。]["”’)]?$/u.test(text) ? text : `${text}.`);
const cityOf = (place: string) => place.split(",")[0]?.trim() ?? "";

/** The spoken script for one unit of a feature book. Every segment says which block it reads (ref). */
export function featureNarration(document: BookDocument, unit: number): ChapterScript {
  const segments: Segment[] = [];
  const add = (text: string, pause: Pause, ref: string) => {
    const value = clean(text);
    if (value) segments.push({ text: sentenceEnd(value), pause, ref });
  };
  const english = (document.language || "en") === "en";
  if (unit === 0) {
    add(document.title, "long", "t");
    if (document.standfirst) add(document.standfirst, "short", "s");
    add(document.preface, "long", "pf");
    return { title: clean(document.title), segments };
  }
  const chapter = document.chapters[unit - 1];
  if (document.form !== "continuous") add(chapter.title, "long", "t");
  const quotes = new Map(chapter.quotes.filter((q) => !q.hidden).map((q) => [q.id, q]));
  const seenClusters = new Set<string>();
  let previous = "";
  (chapter.blocks ?? []).forEach((block, index) => {
    if (block.kind === "break") {
      if (segments.length) segments[segments.length - 1].pause = "long";
      return;
    }
    if (block.kind === "p") {
      const first = block.cluster && !seenClusters.has(block.cluster);
      if (block.cluster) seenClusters.add(block.cluster);
      add(block.text, "short", `${first ? "c" : "p"}${index}`);
      previous = block.text;
      return;
    }
    const quote = quotes.get(block.quoteId);
    if (!quote) return;
    const text = clean(quote.englishText);
    if (!text) return;
    const standout = document.outline?.standouts.find((s) => s.voiceId === quote.voiceId);
    const name = clean(standout?.name ?? "");
    const city = cityOf(standout?.place ?? "");
    // The book usually leads into the quote already; if it did not, the narrator does ("As Priya from Chennai put it").
    const led = (name && previous.includes(name.split(" ")[0])) || (city && previous.includes(city));
    const lead = !led && english ? (name ? `As ${name}${city ? ` from ${city}` : ""} put it: ` : city ? `As one person in ${city} put it: ` : "") : "";
    add(`${lead}${text}`, "short", `q${index}`);
    previous = "";
  });
  if (unit === document.chapters.length && english && document.outline) {
    add(`This book was made from the voices of ${document.outline.total} ${document.outline.total === 1 ? "person" : "people"}. Thank you for listening.`, "long", "end");
  }
  if (segments.length) segments[segments.length - 1].pause = "long";
  return { title: document.form === "continuous" ? clean(document.title) : clean(chapter.title), segments };
}

export const SPOKEN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "text"], properties: { id: { type: "integer" }, text: { type: "string" } } } },
  },
};

/** The script writer's job for a feature book: make each paragraph easy to hear, without changing what it says. */
export function spokenPrompt(input: { languageName: string; bookTitle: string; script: ChapterScript }) {
  const system = [
    `You prepare a book's text to be read aloud by one calm narrator, in ${input.languageName}.`,
    "For each item of kind \"read\", return it ready to be spoken: split sentences longer than 25 words, write numbers, symbols and abbreviations as words, remove brackets.",
    "Keep the meaning, the order, every name and place, and every phrase in quotation marks word for word (drop the quotation marks themselves). Do not add or remove ideas. Keep about the same length.",
    "Items of kind \"quote\" are people's exact words: do not return them.",
  ].join("\n");
  const user = JSON.stringify({
    book: input.bookTitle,
    items: input.script.segments.map((s, id) => ({ id, kind: s.ref?.startsWith("q") ? "quote" : "read", text: s.text })),
  });
  return { system, user };
}

export function applySpoken(raw: unknown, script: ChapterScript): ChapterScript {
  const items = Array.isArray((raw as { items?: unknown })?.items) ? (raw as { items: { id?: unknown; text?: unknown }[] }).items : [];
  const byId = new Map(items.map((item) => [Number(item.id), typeof item.text === "string" ? item.text : ""]));
  return {
    ...script,
    segments: script.segments.map((segment, id) => {
      if (segment.ref?.startsWith("q") || segment.ref === "t") return segment;
      const text = clean((byId.get(id) ?? "").replace(/[*_#`[\]{}<>]/g, ""));
      if (!text || text.length < segment.text.length * 0.6 || text.length > segment.text.length * 1.6) return segment;
      return { ...segment, text: sentenceEnd(text) };
    }),
  };
}
