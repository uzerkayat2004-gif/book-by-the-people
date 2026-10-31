import { themeLabel } from "./plan";
export type Decision = "approved" | "needs_you" | "not_used" | "hidden";

export type VoiceReview = {
  onTopic: boolean;
  realPerson: boolean;
  copyPaste: boolean;
  impersonation: boolean;
  duplicate: boolean;
  decision: Decision;
  theme: string;
  notes: string[];
};

const STOP = new Set([
  "the", "a", "an", "of", "to", "and", "or", "is", "are", "you", "your", "i", "me", "my",
  "in", "on", "for", "with", "that", "this", "it", "be", "was", "from", "what", "when",
  "have", "has", "had", "not", "but", "they", "them", "their", "our", "we", "who",
]);

const IMPERSONATED = new Set([
  "elon musk",
  "taylor swift",
  "barack obama",
  "donald trump",
  "oprah winfrey",
  "narendra modi",
  "virat kohli",
]);

export function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !STOP.has(word));
}

export function jaccard(left: string[], right: string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

function titleWord(word: string): string {
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : "Voices";
}

/**
 * Only an exact copy of words already in the book is left out on its own.
 * Off the question, close to another voice, or a famous name: the voice is kept
 * and waits for the creator to decide. People can add as many voices as the
 * book's daily limit allows, so a second voice from the same person is welcome.
 */
function decide(realPerson: boolean, onTopic: boolean, copyPaste: boolean, duplicate: boolean, impersonation: boolean): Decision {
  if (!realPerson) return "hidden";
  if (copyPaste) return "not_used";
  if (!onTopic || duplicate || impersonation) return "needs_you";
  return "approved";
}

export function reviewVoice(input: {
  id: string;
  question: string;
  text: string;
  name: string;
  startWordPassed: boolean;
  kind: "voice" | "sourced_quote";
  sourceUrl: string | null;
  others: { id: string; text: string }[];
}): VoiceReview {
  const words = contentWords(input.text);
  const questionWords = contentWords(input.question);
  const overlap = words.filter((word) => questionWords.includes(word));
  // Chinese, Japanese and Thai don't put spaces between words, so a long answer counts on its length.
  const unspaced = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u.test(input.text) && input.text.trim().length >= 30;
  const onTopic = input.kind === "sourced_quote" ? input.text.trim().length >= 12 : overlap.length > 0 || words.length >= 6 || unspaced;
  const realPerson = input.kind === "sourced_quote" ? Boolean(input.sourceUrl) : input.startWordPassed;
  const normalized = input.text.toLowerCase().replace(/\s+/g, " ").trim();
  const copyPaste = input.others.some((other) => other.id !== input.id && other.text.toLowerCase().replace(/\s+/g, " ").trim() === normalized);
  const duplicate =
    !copyPaste &&
    input.others.some((other) => other.id !== input.id && jaccard(words, contentWords(other.text)) >= 0.72);
  const impersonation = input.kind !== "sourced_quote" && IMPERSONATED.has(input.name.trim().toLowerCase());
  const notes: string[] = [];
  if (!realPerson) notes.push(input.kind === "sourced_quote" ? "No public source." : "The start word was missing.");
  if (copyPaste) notes.push("Same words as another voice.");
  if (duplicate) notes.push("Too close to another voice.");
  if (impersonation) notes.push("Name matches a public figure. A person has to confirm it.");

  // The word-count topic test is only a rough guess: it never holds a voice back on its own.
  // (With an AI model on, the model's own topic check can send a voice to the creator.)
  const decision = decide(realPerson, true, copyPaste, duplicate, impersonation);

  const theme = words.length ? themeLabel([{ text: input.text }]) : titleWord(overlap[0] || "voices");
  return { onTopic, realPerson, copyPaste, impersonation, duplicate, decision, theme, notes };
}

/**
 * Live mode: muse-spark judges topic, impersonation and the theme name.
 * Copy-paste, duplicate and the real-person start-word check stay
 * deterministic. The final decision is recomputed with the same rules.
 */
export function mergeModelReview(
  base: VoiceReview,
  model: { onTopic: boolean; impersonation: boolean; theme: string; note?: string },
  kind: "voice" | "sourced_quote",
): VoiceReview {
  const onTopic = model.onTopic;
  const impersonation = kind !== "sourced_quote" && (base.impersonation || model.impersonation);
  const notes = base.notes.filter((note) => note !== "Off the question." && !note.startsWith("Name matches"));
  if (!onTopic) notes.unshift("Off the question.");
  if (impersonation) notes.push(model.note?.trim() || "Name matches a public figure. A person has to confirm it.");
  const decision = decide(base.realPerson, onTopic, base.copyPaste, base.duplicate, impersonation);
  const theme = model.theme.trim().slice(0, 48) || base.theme;
  return { ...base, onTopic, impersonation, decision, theme, notes };
}

export function stripPeopleCounts(text: string): string {
  return text
    .replace(/\b\d+\s+people said this\b/gi, "")
    .replace(/\bsaid by \d+\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
