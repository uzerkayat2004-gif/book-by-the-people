import type { BookDocument } from "../book/types";
import { stripPeopleCounts } from "../book/checks";

/** The narration reads the whole book: preface, every chapter and every visible voice. Capped near an hour. */
const MAX_SCRIPT = 50_000;

const ORDINALS = ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];

export function narrationScript(document: BookDocument): string {
  const clean = (part: string | null | undefined) => stripPeopleCounts((part ?? "").replace(/\s+/g, " ").trim());
  // Each piece ends with a full stop unless it already has one, so the voice pauses between them.
  const sentence = (text: string) => (/[.!?…:]["”’)]?$/u.test(text) ? text : `${text}.`);
  const parts: string[] = [document.title, document.question, document.preface];
  document.chapters.forEach((chapter, index) => {
    parts.push(`Chapter ${ORDINALS[index] ?? index + 1}. ${clean(chapter.title)}`);
    parts.push(chapter.narrative);
    for (const quote of chapter.quotes ?? []) {
      if (quote.hidden) continue;
      const text = clean(quote.englishText);
      if (!text) continue;
      const name = clean(quote.speakerName);
      parts.push(name ? `${name} said: ${text}` : text);
    }
    parts.push(chapter.agreement ?? "", chapter.disagreement ?? "");
  });
  const script = parts
    .map((part) => clean(part))
    .filter(Boolean)
    .map(sentence)
    .join(" ");
  return script.slice(0, MAX_SCRIPT) || document.title;
}
