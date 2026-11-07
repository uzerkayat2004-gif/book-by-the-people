/**
 * Strip leftover model instructions that sometimes leak into a generated standfirst.
 * Only cuts from known instruction markers; never rewrites the prose before them.
 */
const LEAK_MARKERS = [
  /\bWait,\s*need ensure formatting\b/i,
  /\bActually need valid JSON string\b/i,
  /\bkeep internal no extra text\b/i,
  /\bEND\s*Actually output\b/i,
];

export function cleanStandfirst(text: string): string {
  if (!text) return text;
  let cut = text.length;
  for (const marker of LEAK_MARKERS) {
    const match = text.match(marker);
    if (match?.index != null && match.index < cut) cut = match.index;
  }
  return text.slice(0, cut).trim();
}
