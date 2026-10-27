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

export function themeLabel(voices: { text: string }[]): string {
  const documentFrequency = new Map<string, number>();
  for (const voice of voices) {
    for (const token of contentTokens(voice.text).keys()) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  const weak = new Set(["fades", "forget", "worse", "gets", "make", "makes"]);
  const ranked = [...documentFrequency.entries()]
    .filter(([word]) => !weak.has(word) || documentFrequency.size <= 2)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]));
  const top = ranked.slice(0, 2).map(([word]) => word);
  if (top.length === 0) return "Voices";
  return top
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" & ");
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
