import type { BookDocument, Chapter, QuoteSpan } from "./types";
import { countryByCode } from "@/lib/countries";
import { phrasesFor } from "@/lib/media/meta/phrases";

/**
 * The whole finished book as clean plain text, ready to paste into another app
 * (for example Meta AI) to make audio or video from it. Browser safe.
 */
export function bookPlainText(document: BookDocument, counts: { people: number; countries: number }): string {
  const say = phrasesFor(document.language || "en");
  const tidy = (text: string | null | undefined) =>
    (text ?? "")
      .replace(/[*_#`]+/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .trim();
  const people = document.outline?.total || counts.people;
  const countries = document.outline?.countries ?? counts.countries;
  const out: string[] = [];
  const push = (text: string | null | undefined) => {
    const value = tidy(text);
    if (value) out.push(value);
  };
  const quoteLine = (quote: QuoteSpan) => {
    const text = tidy(quote.englishText || quote.originalText);
    if (!text) return "";
    const name = tidy(quote.speakerName);
    const place = quote.countryCode ? (countryByCode(quote.countryCode)?.name ?? "") : "";
    const who = place && !name.toLowerCase().includes(place.toLowerCase()) ? [name, place].filter(Boolean).join(", ") : name;
    return `“${text.replace(/^["“”]+|["“”]+$/g, "")}”${who ? ` — ${who}` : ""}`;
  };
  const chapterBody = (chapter: Chapter) => {
    const shown = chapter.quotes.filter((quote) => !quote.hidden);
    if (chapter.blocks?.length) {
      for (const block of chapter.blocks) {
        if (block.kind === "p") push(block.text);
        else if (block.kind === "break") push(block.title ? block.title : "* * *");
        else {
          const quote = shown.find((q) => q.id === block.quoteId);
          if (quote) {
            push(quoteLine(quote));
          }
        }
      }
      return;
    }
    for (const paragraph of (chapter.narrative ?? "").split(/\n{2,}/)) push(paragraph);
    for (const quote of shown) push(quoteLine(quote));
    if (chapter.agreement) push(`Where people agree: ${tidy(chapter.agreement)}`);
    if (chapter.disagreement) push(`Where people differ: ${tidy(chapter.disagreement)}`);
  };

  push(document.title);
  push(document.question);
  if (people > 0) push(say.intro(people, countries));
  push(document.standfirst);
  push(document.preface);
  const continuous = document.form === "continuous";
  document.chapters.forEach((chapter, index) => {
    if (!continuous) push(`${index + 1}. ${tidy(chapter.title)}`);
    chapterBody(chapter);
  });
  if (people > 0) push(say.end(people));
  return out.join("\n\n") + "\n";
}
