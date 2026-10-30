/**
 * Helpers for the browser's own speech-to-text, used only when the book has no speech model.
 * Android Chrome repeats the whole session in every result ("hey", "hey right", "hey right now"),
 * so a session's text is rebuilt from all results and replaces the previous version instead of appending.
 */

export type ResultLike = { isFinal: boolean; 0?: { transcript: string } };

const norm = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Joins result phrases, folding cumulative repeats (each phrase containing the one before). */
export function foldPhrases(phrases: string[]): string {
  let out = "";
  for (const raw of phrases) {
    const phrase = raw.replace(/\s+/g, " ").trim();
    if (!phrase) continue;
    const a = norm(out);
    const b = norm(phrase);
    if (!a) out = phrase;
    else if (b.startsWith(a)) out = phrase;
    else if (a.endsWith(b) || a.includes(b)) continue;
    else out = `${out} ${phrase}`;
  }
  return out.trim();
}

/** Drops leading words of `phrase` that repeat `before` word for word. */
function afterPrefix(before: string, phrase: string): string {
  const a = norm(before).split(" ").filter(Boolean);
  const words = phrase.trim().split(/\s+/).filter(Boolean);
  if (!a.length || words.length < a.length) return phrase.trim();
  for (let i = 0; i < a.length; i += 1) if (norm(words[i]) !== a[i]) return phrase.trim();
  return words.slice(a.length).join(" ");
}

/** The whole session so far: finished phrases plus the phrase still being heard. */
export function sessionText(results: ArrayLike<ResultLike>): { final: string; interim: string } {
  const finals: string[] = [];
  const interims: string[] = [];
  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    const text = result?.[0]?.transcript ?? "";
    (result?.isFinal ? finals : interims).push(text);
  }
  const final = foldPhrases(finals);
  let interim = afterPrefix(final, foldPhrases(interims));
  if (interim && norm(final).endsWith(norm(interim))) interim = "";
  return { final, interim };
}

export function isAndroid(userAgent: string): boolean {
  return /Android/i.test(userAgent);
}
