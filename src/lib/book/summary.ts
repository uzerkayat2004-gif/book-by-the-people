/** Short text for chapter lists and cards. Pure, so pages and client components can share it. */

const same = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]+/g, "") === b.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Cuts text at a word near `max` characters and adds an ellipsis. */
export function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).replace(/[,;:.\s]+$/, "")}…`;
}

/** One line under a chapter title: the theme, or the narrative's first sentence, never the title again. */
export function chapterSummary(title: string, theme: string, narrative: string): string {
  if (theme && !same(theme, title)) return clip(theme, 120);
  const sentence = (narrative || "").split(/(?<=[.!?])\s+/)[0] ?? "";
  if (sentence && !same(sentence, title)) return clip(sentence, 120);
  return "";
}
