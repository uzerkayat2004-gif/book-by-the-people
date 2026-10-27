import type { ChapterPlan, SourceVoice } from "./types";

const STOP = new Set(
  `the a an and or but if in on at to for of as is it this that with from by be are was were been being i you we they he she my your our their not no so do did does have has had will just about into over after before than then too very can could should would what when who how which your you its it's im i'm ive don't dont isn't didn't can't wont won't really also more most some any only other such same still even back well much many out off all one two make makes made making use used using because when about into onto people thing things something anything`.split(
    /\s+/,
  ),
);

const GAIN = ["smarter", "learn", "learning", "helpful", "better", "useful", "curious", "sharper", "faster"];
const COST = ["lazier", "lazy", "worse", "harm", "shortcut", "distraction", "replace", "worried", "fear", "forget", "forgetting"];

export function contentTokens(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}']+/u)) {
    const token = raw.replace(/^'+|'+$/g, "");
    if (token.length < 4 || STOP.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

export function similarity(left: Map<string, number>, right: Map<string, number>): number {
  const keysA = new Set(left.keys());
  const keysB = new Set(right.keys());
  let intersection = 0;
  for (const key of keysA) if (keysB.has(key)) intersection += 1;
  const union = keysA.size + keysB.size - intersection;
  const jaccard = union === 0 ? 0 : intersection / union;

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const value of left.values()) leftNorm += value * value;
  for (const value of right.values()) rightNorm += value * value;
  const [small, large] = left.size < right.size ? [left, right] : [right, left];
  for (const [key, value] of small) {
    const other = large.get(key);
    if (other) dot += value * other;
  }
  const cosine = leftNorm === 0 || rightNorm === 0 ? 0 : dot / Math.sqrt(leftNorm * rightNorm);
  return Math.max(jaccard, cosine);
}

const EDGE = new Set([...STOP, "yaar", "gets", "get", "got", "makes", "make", "made", "when", "while", "lets", "let"]);

const PRONOUN = new Set(["i", "me", "my", "you", "your", "we", "our", "us", "he", "she", "they", "them", "it", "i'm", "makes", "make", "gets", "get", "because", "will", "want", "did", "does", "when", "and", "or", "but", "not"]);

function shape(phrase: string): number {
  const parts = phrase.split(" ");
  if (parts.length === 3 && parts[1] === "the") return 3;
  if (parts.length === 3 && parts[0] === "the") return 2;
  if (parts[0] === "the") return 1;
  return 0;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function phrases(text: string): Set<string> {
  const list = words(text);
  const found = new Set<string>();
  for (let size = 2; size <= 4; size += 1) {
    for (let index = 0; index + size <= list.length; index += 1) {
      const gram = list.slice(index, index + size);
      if (EDGE.has(gram[0]) && gram[0] !== "the") continue;
      if (EDGE.has(gram[gram.length - 1])) continue;
      if (gram.filter((word) => !STOP.has(word) && word.length > 3).length === 0) continue;
      if (gram.some((word) => PRONOUN.has(word))) continue;
      found.add(gram.join(" "));
    }
  }
  return found;
}

function sentenceCase(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ").replace(/\bi\b/g, "I");
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : clean;
}

/**
 * A short, readable chapter title built only from the voices' own words:
 * the longest phrase that most voices in the group share, or the opening
 * words of the first voice. Deterministic, so mock mode is repeatable.
 */
const DANGLING = /(ed|al|en|ive|ous|ful|less|ing|ly)$/;
function endsClean(phrase: string): boolean {
  const parts = phrase.toLowerCase().split(" ");
  const last = parts[parts.length - 1] ?? "";
  if (parts.includes("i")) return false;
  return !(last.length > 3 && DANGLING.test(last));
}

export function themeLabel(voices: { text: string }[]): string {
  if (voices.length === 0) return "Voices";
  const counts = new Map<string, number>();
  for (const voice of voices) {
    for (const phrase of phrases(voice.text)) counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }
  const need = voices.length >= 2 ? 2 : 1;
  const ranked = [...counts.entries()]
    .filter(([phrase, count]) => count >= need && endsClean(phrase))
    .sort((a, b) => b[1] - a[1] || shape(b[0]) - shape(a[0]) || b[0].split(" ").length - a[0].split(" ").length || a[0].localeCompare(b[0]));
  if (ranked.length > 0 && voices.length >= 2) return sentenceCase(ranked[0][0]);
  const own = [...phrases(voices[0].text)].filter(endsClean).sort((a, b) => shape(b) - shape(a) || a.localeCompare(b));
  if (own.length > 0 && shape(own[0]) >= 2) return sentenceCase(own[0]);
  const first = words(voices[0].text);
  const start = first.findIndex((word) => !EDGE.has(word) && word.length > 3);
  if (start < 0) return "Voices";
  const slice = first.slice(Math.max(0, start - 1), start + 3);
  while (slice.length > 1 && EDGE.has(slice[slice.length - 1])) slice.pop();
  if (slice.length > 1 && STOP.has(slice[0]) && slice[0] !== "the") slice.shift();
  return sentenceCase(slice.join(" "));
}

export function stanceScore(text: string): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const word of GAIN) if (lower.includes(word)) score += 1;
  for (const word of COST) if (lower.includes(word)) score -= 1;
  return score;
}

export function agreementNotes(texts: string[]): { agreement: string | null; disagreement: string | null } {
  if (texts.length < 2) return { agreement: null, disagreement: null };
  const scores = texts.map(stanceScore);
  const gains = scores.filter((score) => score > 0).length;
  const costs = scores.filter((score) => score < 0).length;
  if (gains > 0 && costs > 0) {
    return {
      agreement: null,
      disagreement: `${gains} ${gains === 1 ? "voice describes" : "voices describe"} a gain and ${costs} ${costs === 1 ? "describes" : "describe"} a cost.`,
    };
  }
  if (gains >= 2) {
    return { agreement: "They land on the same side: this is mostly a gain.", disagreement: null };
  }
  if (costs >= 2) {
    return { agreement: "They land on the same side: this is mostly a cost.", disagreement: null };
  }
  return { agreement: null, disagreement: null };
}

type Cluster = {
  voices: SourceVoice[];
  centroid: Map<string, number>;
};

function voiceText(voice: SourceVoice): string {
  return (voice.englishText || voice.originalText).trim();
}

function mergeClosest(clusters: Cluster[]): { clusters: Cluster[]; similarity: number } | null {
  if (clusters.length < 2) return null;
  let bestI = 0;
  let bestJ = 1;
  let best = -1;
  for (let i = 0; i < clusters.length; i += 1) {
    for (let j = i + 1; j < clusters.length; j += 1) {
      const score = similarity(clusters[i].centroid, clusters[j].centroid);
      if (score > best) {
        best = score;
        bestI = i;
        bestJ = j;
      }
    }
  }
  const voices = [...clusters[bestI].voices, ...clusters[bestJ].voices].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
  const merged: Cluster = {
    voices,
    centroid: contentTokens(voices.map(voiceText).join(" ")),
  };
  const next = clusters.filter((_, index) => index !== bestI && index !== bestJ);
  next.push(merged);
  return { clusters: next, similarity: best };
}

function chunk(voices: SourceVoice[], size: number): SourceVoice[][] {
  const groups: SourceVoice[][] = [];
  for (let index = 0; index < voices.length; index += size) {
    groups.push(voices.slice(index, index + size));
  }
  return groups;
}

export function planChapters(voices: SourceVoice[], bookType: string): ChapterPlan[] {
  const usable = voices
    .filter((voice) => voice.status === "READY" && !voice.hidden && (voice.englishText || voice.originalText).trim())
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  if (usable.length === 0) return [];
  if (usable.length === 1) {
    return [{ voiceIds: [usable[0].id], theme: themeLabel([{ text: voiceText(usable[0]) }]) }];
  }

  let clusters: Cluster[] = usable.map((voice) => ({
    voices: [voice],
    centroid: contentTokens(voiceText(voice)),
  }));

  const cap = Math.min(8, usable.length);
  while (clusters.length > 1) {
    const merged = mergeClosest(clusters);
    if (!merged) break;
    const overCap = clusters.length > cap;
    if (merged.similarity >= 0.28 || overCap) clusters = merged.clusters;
    else break;
  }

  let groups = clusters
    .map((cluster) => [...cluster.voices].sort((a, b) => a.createdAt - b.createdAt))
    .sort((a, b) => a[0].createdAt - b[0].createdAt || a[0].id.localeCompare(b[0].id));

  const splitSize = bookType === "SOLO" ? (usable.length >= 4 ? (usable.length >= 8 ? 3 : 2) : 0) : 5;
  if (bookType === "SOLO" && groups.length === 1 && usable.length >= 4) {
    groups = chunk(groups[0], splitSize);
  } else if (bookType !== "SOLO") {
    const exploded: SourceVoice[][] = [];
    for (const group of groups) {
      if (group.length > 5) exploded.push(...chunk(group, 4));
      else exploded.push(group);
    }
    groups = exploded;
  }

  return groups.map((group, index) => ({
    voiceIds: group.map((voice) => voice.id),
    theme:
      bookType === "SOLO" && groups.length > 1 && themeLabel(group.map((voice) => ({ text: voiceText(voice) }))) === themeLabel(groups[0].map((voice) => ({ text: voiceText(voice) })))
        ? `Part ${index + 1}`
        : themeLabel(group.map((voice) => ({ text: voiceText(voice) }))),
  }));
}
