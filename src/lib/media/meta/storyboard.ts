/** The video book's storyboard: which picture or quote card is on screen while each part of the narration plays. Pure helpers. */
import type { BookDocument } from "@/lib/book/types";
import { stripPeopleCounts } from "@/lib/book/checks";
import type { ChapterScript } from "./text";

export type SceneKind = "picture" | "quote" | "card";
/** One scene, starting at a narration segment of its chapter. */
export type Scene = { kind: SceneKind; segment: number; prompt?: string; quote?: number };
export type Storyboard = { scenes: Scene[] };
export type QuoteRef = { text: string; speaker: string; country: string | null };

export const MAX_SCENES_PER_UNIT = 5;
export const MAX_PICTURES_PER_UNIT = 3;

const clean = (part: string | null | undefined) => stripPeopleCounts((part ?? "").replace(/\s+/g, " ").trim());

/** The quotes a chapter can show as cards (hidden ones never appear). Unit 0 (the opening) has none. */
export function unitQuotes(document: BookDocument, unit: number): QuoteRef[] {
  if (unit === 0) return [];
  const chapter = document.chapters[unit - 1];
  return (chapter?.quotes ?? [])
    .filter((quote) => !quote.hidden && clean(quote.englishText || quote.originalText))
    .map((quote) => ({ text: clean(quote.englishText || quote.originalText), speaker: clean(quote.speakerName) || "Someone", country: quote.countryCode ?? null }));
}

export const STORYBOARD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scenes"],
  properties: {
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "segment", "prompt", "quote"],
        properties: {
          kind: { type: "string", enum: ["picture", "quote"] },
          segment: { type: "integer" },
          prompt: { type: "string" },
          quote: { type: "integer" },
        },
      },
    },
  },
};

/** One look for every picture in a book's film, chosen from the book itself. */
export type ArtDirection = { style: string; palette: string; lighting: string; world: string };

/** What no picture may contain. Sent with every picture prompt. */
export const PICTURE_AVOID =
  "Avoid: any text, letters, numbers, captions, signs, book pages with readable writing, logos, watermarks, signatures, frames or borders, split panels, recognisable real or famous people, distorted or extra fingers, malformed hands, deformed or blurred faces, crowds with copied faces.";

export const ART_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["style", "palette", "lighting", "world"],
  properties: { style: { type: "string" }, palette: { type: "string" }, lighting: { type: "string" }, world: { type: "string" } },
};

/** Asks for one art direction from the book's outline: style, palette, lighting and the visual world. */
export function artPrompt(document: BookDocument) {
  const outline = document.outline;
  const system = [
    "You are the art director of a calm, documentary-style film made from a book of real people's voices. Choose ONE look for every picture in the film.",
    "style: the medium and finish in one phrase (for example painterly cinematic illustration with soft film grain, or 35mm documentary photograph look). Always calm, human and warm; never cartoonish.",
    "palette: 3 to 5 colours that suit the book's mood, as plain colour words.",
    "lighting: one phrase (time of day, quality of light).",
    "world: one sentence on the kinds of places and objects that recur, drawn from where the voices come from and what they talk about.",
    "Write short phrases, no names of real people, no words to show in the picture.",
  ].join("\n");
  const user = JSON.stringify({
    title: document.title,
    question: document.question,
    arc: outline?.arc ?? "",
    views: (outline?.clusters ?? []).slice(0, 8).map((c) => `${c.label} (${c.count})`),
    places: [...new Set((outline?.clusters ?? []).flatMap((c) => c.countries.map((x) => x.code)))].slice(0, 12),
  });
  return { system, user };
}

const phrase = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

export function parseArt(raw: unknown): ArtDirection {
  const data = (raw ?? {}) as Record<string, unknown>;
  const art = { style: phrase(data.style, 160), palette: phrase(data.palette, 160), lighting: phrase(data.lighting, 120), world: phrase(data.world, 260) };
  if (!art.style || !art.palette || !art.lighting) throw new Error("The art direction came back incomplete.");
  return art;
}

/** Without a model: the house look. */
export const PLAIN_ART: ArtDirection = {
  style: "painterly cinematic editorial illustration, soft film grain, 16:9 wide frame",
  palette: "deep ember red, charcoal, warm amber, muted cream",
  lighting: "warm low light, late afternoon or lamp light",
  world: "everyday places where people live, learn and work",
};

/** The art direction as one line added to every picture prompt. */
export function artLine(art: ArtDirection | undefined): string {
  const a = art ?? PLAIN_ART;
  return `Style: ${a.style}. Palette: ${a.palette}. Lighting: ${a.lighting}. Calm, human, documentary mood; leave the lower third of the frame quiet and uncluttered.`;
}

export const CHECK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["score", "problems", "fix"],
  properties: { score: { type: "integer" }, problems: { type: "array", items: { type: "string" } }, fix: { type: "string" } },
};

/** Asks the writer model to look at one picture and say how well it fits its brief. */
export function checkPrompt(brief: string) {
  return {
    system: [
      "You check pictures for a documentary film. Look at the picture and compare it with its brief.",
      "score 1 to 5: 5 fits the brief with no defects; 3 is usable; 1 or 2 must be redrawn.",
      'problems: short phrases, only real ones, from: "readable text", "watermark or logo", "distorted hands", "deformed face", "off-brief subject", "wrong mood", "cluttered".',
      "fix: one sentence telling the painter what to change, or empty.",
    ].join("\n"),
    user: `Brief: ${brief.slice(0, 1200)}`,
  };
}

/** Should a checked picture be drawn once more? Only for clear faults, never for taste. */
export function needsRedraw(raw: unknown): { redo: boolean; score: number; fix: string; problems: string[] } {
  const data = (raw ?? {}) as { score?: unknown; problems?: unknown; fix?: unknown };
  const score = Math.max(1, Math.min(5, Math.round(Number(data.score) || 3)));
  const problems = (Array.isArray(data.problems) ? data.problems : []).map(String).slice(0, 6);
  const fix = phrase(data.fix, 300);
  const defect = problems.some((p) => /text|letter|watermark|logo|hand|finger|face|deform|distort/i.test(p));
  return { redo: score <= 2 || defect, score, fix, problems };
}

/** The look every picture shares, so a film feels like one piece. */
export const PICTURE_STYLE =
  "Cinematic editorial illustration, painterly, soft film grain, warm low light with deep ember red and charcoal tones, 16:9 wide shot, calm and human. No text, no letters, no logos, no watermarks, no recognisable real people.";

export function storyboardPrompt(input: { unit: number; total: number; bookTitle: string; question: string; script: ChapterScript; quotes: QuoteRef[]; pictures: boolean }) {
  const system = [
    "You are the director of a short documentary film made from a book of real people's voices.",
    "The narration is already recorded. Choose what is on screen while it plays.",
    "Rules:",
    `- Return 1 to ${MAX_SCENES_PER_UNIT} scenes in order. "segment" is the number of the narration segment where the scene starts. The first scene starts at segment 0. Each scene lasts until the next one, so give every scene at least two segments where you can.`,
    input.pictures
      ? `- kind "picture": write "prompt", one vivid sentence describing a picture that fits what is being said (a place, an object, a mood, people seen from behind or far away). Use at least 1 and at most ${MAX_PICTURES_PER_UNIT} pictures, spread across the whole part, and alternate pictures with quotes (a picture after a quote where there is room). Never put words, signs, names or real people in a picture.`
      : '- Pictures are off: do not use kind "picture".',
    input.quotes.length
      ? '- kind "quote": show one of the listed quotes as a card while the narration reads it. "quote" is its number. Use each quote at most once, at the segment where it is read.'
      : '- There are no quotes to show in this part: do not use kind "quote".',
    '- Use "" for prompt and -1 for quote when they do not apply.',
    "- Do not invent facts. Do not say or show how many people took part.",
  ].join("\n");
  const lines = [
    `Book: ${input.bookTitle}`,
    `Question: ${input.question}`,
    input.unit === 0 ? "Part: the opening" : `Part: chapter ${input.unit} of ${input.total - 1}`,
    "",
    "Narration segments:",
    ...input.script.segments.map((segment, index) => `${index}. ${segment.text}`),
  ];
  if (input.quotes.length) lines.push("", "Quotes:", ...input.quotes.map((quote, index) => `${index}. ${quote.speaker}: "${quote.text}"`));
  return { system, user: lines.join("\n") };
}

/** Reads the model's storyboard and makes it safe to play: valid segments, in order, real quotes, picture limits. Throws if nothing usable is left. */
export function parseStoryboard(raw: unknown, segments: number, quotes: number, pictures: boolean): Storyboard {
  const data = raw as { scenes?: unknown };
  if (!data || !Array.isArray(data.scenes)) throw new Error("The storyboard came back without scenes.");
  const scenes: Scene[] = [];
  const usedQuotes = new Set<number>();
  let pictureCount = 0;
  for (const item of data.scenes as { kind?: unknown; segment?: unknown; prompt?: unknown; quote?: unknown }[]) {
    const segment = Math.floor(Number(item?.segment));
    if (!Number.isFinite(segment) || segment < 0 || segment >= segments) continue;
    if (scenes.length && segment <= scenes[scenes.length - 1].segment) continue;
    if (item.kind === "quote") {
      const quote = Math.floor(Number(item.quote));
      if (!Number.isFinite(quote) || quote < 0 || quote >= quotes || usedQuotes.has(quote)) continue;
      usedQuotes.add(quote);
      scenes.push({ kind: "quote", segment, quote });
    } else if (item.kind === "picture" && pictures && pictureCount < MAX_PICTURES_PER_UNIT) {
      const prompt = typeof item.prompt === "string" ? item.prompt.replace(/\s+/g, " ").trim().slice(0, 600) : "";
      if (!prompt) continue;
      pictureCount += 1;
      scenes.push({ kind: "picture", segment, prompt });
    }
    if (scenes.length >= MAX_SCENES_PER_UNIT) break;
  }
  if (!scenes.length) throw new Error("The storyboard came back empty.");
  // The first scene always starts with the narration.
  scenes[0] = { ...scenes[0], segment: 0 };
  return { scenes };
}

/** Where a quote is read in the narration (by its first words), or -1. */
export function findQuoteSegment(script: ChapterScript, quote: QuoteRef): number {
  const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const head = words(quote.text).slice(0, 6).join(" ");
  if (!head) return -1;
  return script.segments.findIndex((segment) => words(segment.text).join(" ").includes(head));
}

/** The storyboard without a model: a card or picture to open, then each quote as it is read. */
export function plainStoryboard(input: { unit: number; script: ChapterScript; quotes: QuoteRef[]; pictures: boolean; title: string; theme?: string; question: string }): Storyboard {
  const scenes: Scene[] = [];
  const prompt = input.unit === 0 ? `An evocative scene about the question: ${input.question}` : `An evocative scene about "${input.title}"${input.theme ? `: ${input.theme}` : ""}`;
  scenes.push(input.pictures && input.unit > 0 ? { kind: "picture", segment: 0, prompt } : { kind: "card", segment: 0 });
  if (input.unit === 0 && input.pictures && input.script.segments.length > 2) scenes.push({ kind: "picture", segment: 2, prompt });
  input.quotes.forEach((quote, index) => {
    const segment = findQuoteSegment(input.script, quote);
    if (segment > (scenes[scenes.length - 1]?.segment ?? -1) && scenes.length < MAX_SCENES_PER_UNIT) scenes.push({ kind: "quote", segment, quote: index });
  });
  return { scenes };
}

/** Splits a long caption into lines of at most `max` characters, timed by length. */
export function captionChunks(cue: { startMs: number; endMs: number; text: string }, max = 84): { startMs: number; endMs: number; text: string }[] {
  // Break where a reader would breathe: after a sentence first, then a comma, colon or dash; words only as a last resort.
  const clauses = cue.text
    .split(/(?<=[.!?。！？।,;:，،؛])\s+|\s+(?=[—–]\s)/u)
    .map((c) => c.trim())
    .filter(Boolean);
  const pieces: string[] = [];
  for (const clause of clauses) {
    if (clause.length <= max) {
      pieces.push(clause);
      continue;
    }
    let line = "";
    for (const word of clause.split(/\s+/)) {
      if (line && (line + " " + word).length > max) {
        pieces.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    if (line) pieces.push(line);
  }
  const chunks: string[] = [];
  for (const piece of pieces) {
    const last = chunks[chunks.length - 1];
    // Join short clauses into one caption; a new sentence starts a new caption unless the last one was very short.
    if (last !== undefined && (last + " " + piece).length <= max && !(/[.!?。！？।]$/u.test(last) && last.length >= 20)) chunks[chunks.length - 1] = `${last} ${piece}`;
    else chunks.push(piece);
  }
  const total = chunks.reduce((sum, c) => sum + c.length, 0) || 1;
  let at = cue.startMs;
  return chunks.map((text) => {
    const length = ((cue.endMs - cue.startMs) * text.length) / total;
    const out = { startMs: Math.round(at), endMs: Math.round(at + length), text };
    at += length;
    return out;
  });
}

/** Two caption lines at most, broken where the phrase breaks (after punctuation) and as even as possible. */
export function captionLines(text: string, measure: (s: string) => number, maxWidth: number): string[] {
  if (measure(text) <= maxWidth) return [text];
  const words = text.split(/\s+/).filter(Boolean);
  let best: string[] = [text];
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const wa = measure(a);
    const wb = measure(b);
    const over = Math.max(0, wa - maxWidth) + Math.max(0, wb - maxWidth);
    // A break at a comma or full stop is worth a lot; before "and", "but", "because" a little; mid-phrase costs most.
    const cost = /[,;:.!?\u2014\u2013\uff0c\u3001\u060c]$/u.test(a) ? 0 : /^(and|but|or|so|because|that|who|which|when|while|where|y|et|und|que|e|и|و)$/i.test(words[i]) ? 0.2 : 0.4;
    const score = over * 10 + Math.abs(wa - wb) + cost * maxWidth + (wb >= wa ? 0 : 1);
    if (score < bestScore) {
      bestScore = score;
      best = [a, b];
    }
  }
  return best;
}

/** Makes sure a part with pictures on has at least one picture: after the last scene if there is room, else in place of a plain card. */
export function withPicture(board: Storyboard, segments: number, prompt: string): Storyboard {
  if (board.scenes.some((scene) => scene.kind === "picture")) return board;
  const scenes = [...board.scenes];
  const last = scenes[scenes.length - 1];
  if (!last) return { scenes: [{ kind: "picture", segment: 0, prompt }] };
  if (last.segment + 1 < segments && scenes.length < MAX_SCENES_PER_UNIT) scenes.push({ kind: "picture", segment: last.segment + 1, prompt });
  else {
    const card = scenes.findIndex((scene) => scene.kind === "card");
    if (card >= 0) scenes[card] = { kind: "picture", segment: scenes[card].segment, prompt };
  }
  return { scenes };
}

export type PaceScene = { startMs: number; endMs: number; kind: string; image?: string; unit?: number; chapter?: string };

/**
 * Keeps the film moving: no card or quote stays on screen longer than about `capMs`, and no picture longer than
 * 1.5 × `capMs`. The rest of a long scene is filled with pictures, from the same chapter first, never the same
 * picture twice in a row and never the same quote again. With no pictures at all, the scene stays (it still moves).
 */
export function paceScenes<T extends PaceScene>(scenes: T[], capMs = 8000): T[] {
  const pool = scenes.filter((scene) => scene.kind === "picture" && scene.image);
  const uses = new Map<string, number>();
  for (const scene of pool) uses.set(scene.image!, (uses.get(scene.image!) ?? 0) + 1);
  const out: T[] = [];
  const capOf = (scene: PaceScene) => (scene.kind === "picture" ? capMs * 1.5 : capMs);
  let carry: number | null = null;
  scenes.forEach((original, index) => {
    // The previous scene handed its last seconds to this one (it shows the same picture).
    const scene: T = carry === null ? original : { ...original, startMs: carry };
    carry = null;
    const cap = capOf(scene);
    const following = scenes[index + 1]?.image;
    if (scene.kind === "end" || scene.endMs - scene.startMs <= cap + 2000 || !pool.length) {
      out.push(scene);
      return;
    }
    let t = scene.startMs;
    let current: T = scene;
    while (t < scene.endMs) {
      const left = scene.endMs - t;
      let length = Math.min(capOf(current), left);
      if (left - length < 3000) length = left;
      out.push({ ...current, startMs: t, endMs: t + length, chapter: t === scene.startMs ? scene.chapter : undefined });
      t += length;
      if (t >= scene.endMs) break;
      const previous = out[out.length - 1].image;
      const mid = t + Math.min(capMs, scene.endMs - t) / 2;
      const last = scene.endMs - t <= capMs * 1.5 + 3000;
      const pick = [...pool]
        .filter((p) => p.image !== previous && !(last && p.image === following && pool.some((q) => q.image !== previous && q.image !== following)))
        .sort(
          (a, b) =>
            Number(a.unit !== scene.unit) - Number(b.unit !== scene.unit) ||
            (uses.get(a.image!) ?? 0) - (uses.get(b.image!) ?? 0) ||
            Math.abs((a.startMs + a.endMs) / 2 - mid) - Math.abs((b.startMs + b.endMs) / 2 - mid),
        )[0];
      if (pick && last && pick.image === following) {
        carry = t;
        break;
      }
      if (!pick) {
        // Only one picture and it is already showing: let it run on.
        out[out.length - 1] = { ...out[out.length - 1], endMs: scene.endMs };
        break;
      }
      uses.set(pick.image!, (uses.get(pick.image!) ?? 0) + 1);
      current = { ...scene, kind: "picture", image: pick.image, quote: undefined, title: undefined, subtitle: undefined } as T;
    }
  });
  return out;
}

/* ---------- Feature books: a documentary with fewer, longer picture scenes ---------- */

/** About one picture every half minute of narration, 1 to 6 per part. */
export function picturesFor(ms: number, unit: number): number {
  if (unit === 0) return ms > 20_000 ? 2 : 1;
  return Math.max(1, Math.min(6, Math.round(ms / 30_000)));
}

export function featureBoardPrompt(input: { unit: number; bookTitle: string; question: string; sectionTitle: string; arc: string; script: ChapterScript; count: number; art?: ArtDirection }) {
  const system = [
    "You are the director of a calm documentary film made from a book of real people's voices.",
    "The narration is recorded. Choose the pictures on screen while it plays: one picture holds for a long time with a slow camera move, like a documentary.",
    "Rules:",
    `- Return exactly ${input.count} scenes of kind "picture", in order. "segment" is the narration segment where the picture starts; the first starts at 0. Spread them so each holds for a similar time, and change picture where the narration moves to a new idea.`,
    '- "prompt": two sentences for a picture that fits what is being said at that moment. First the subject with concrete, scene-specific details taken from the narration (the place, objects, season, weather, time of day, a gesture; people seen from behind, far away or as hands). Then the framing (wide establishing shot, medium shot or close-up) and where the light falls. Do not describe the art style: it is set for the whole film.',
    input.art ? `- The film's visual world: ${input.art.world} Keep every picture inside it so the film feels like one piece.` : "- Keep one visual world across the film (the same kind of places, the same light), so the film feels like one piece.",
    "- Never put words, signs, names, logos or recognisable real people in a picture. Do not show crowds of a given size.",
    '- Use -1 for "quote".',
  ].join("\n");
  const lines = [
    `Book: ${input.bookTitle}`,
    `Question: ${input.question}`,
    input.arc ? `The film's arc: ${input.arc}` : "",
    input.unit === 0 ? "Part: the opening" : `Part: ${input.sectionTitle}`,
    "",
    "Narration segments:",
    ...input.script.segments.map((segment, index) => `${index}. ${segment.text}`),
  ].filter((line, i) => line || i > 3);
  return { system, user: lines.join("\n") };
}

export function parseFeatureBoard(raw: unknown, segments: number, count: number): Storyboard {
  const data = raw as { scenes?: unknown };
  if (!data || !Array.isArray(data.scenes)) throw new Error("The storyboard came back without scenes.");
  const scenes: Scene[] = [];
  for (const item of data.scenes as { segment?: unknown; prompt?: unknown }[]) {
    const segment = Math.floor(Number(item?.segment));
    const prompt = typeof item?.prompt === "string" ? item.prompt.replace(/\s+/g, " ").trim().slice(0, 600) : "";
    if (!prompt || !Number.isFinite(segment) || segment < 0 || segment >= segments) continue;
    if (scenes.length && segment <= scenes[scenes.length - 1].segment) continue;
    scenes.push({ kind: "picture", segment, prompt });
    if (scenes.length >= count) break;
  }
  if (!scenes.length) throw new Error("The storyboard came back empty.");
  scenes[0] = { ...scenes[0], segment: 0 };
  return { scenes };
}

/** Without a model: pictures spread evenly, about the part's title. */
export function plainFeatureBoard(segments: number, count: number, prompt: string): Storyboard {
  const n = Math.max(1, Math.min(count, segments));
  const scenes: Scene[] = [];
  for (let i = 0; i < n; i += 1) {
    const segment = Math.floor((i * segments) / n);
    if (scenes.length && segment <= scenes[scenes.length - 1].segment) continue;
    scenes.push({ kind: "picture", segment, prompt: i === 0 ? prompt : `${prompt}, another moment` });
  }
  return { scenes };
}

export type Overlay = { startMs: number; endMs: number; kind: "quote" | "count"; text: string; who?: string; sub?: string };

/**
 * The words over the pictures, timed to the narration: each standout quote as a lower-third while it is read,
 * and how many people shared a view when the book first tells it. Overlays never overlap.
 */
export function featureOverlays(input: {
  segments: { ref?: string }[];
  timeOf: (seg: number) => { startMs: number; endMs: number } | null;
  quoteAt: (blockIndex: number) => { text: string; who: string; sub: string } | null;
  countAt: (blockIndex: number) => { count: number; label: string } | null;
  minCount?: number;
}): Overlay[] {
  const out: Overlay[] = [];
  input.segments.forEach((segment, seg) => {
    const ref = segment.ref ?? "";
    const match = /^([qc])(\d+)$/.exec(ref);
    if (!match) return;
    const time = input.timeOf(seg);
    if (!time) return;
    const block = Number(match[2]);
    if (match[1] === "q") {
      const quote = input.quoteAt(block);
      if (quote) out.push({ startMs: Math.max(0, time.startMs - 250), endMs: time.endMs + 900, kind: "quote", text: quote.text, who: quote.who, sub: quote.sub });
    } else {
      const count = input.countAt(block);
      if (count && count.count >= (input.minCount ?? 3)) out.push({ startMs: time.startMs + 400, endMs: time.startMs + 6400, kind: "count", text: String(count.count), sub: count.label });
    }
  });
  out.sort((a, b) => a.startMs - b.startMs);
  // Quotes (lower left) and count chips (top right) can share the screen; two of the same kind never do.
  const kept: Overlay[] = [];
  for (const overlay of out) {
    const last = [...kept].reverse().find((k) => k.kind === overlay.kind);
    if (last && overlay.startMs < last.endMs + 150) {
      if (overlay.kind === "count") continue;
      last.endMs = Math.max(last.startMs + 1500, overlay.startMs - 150);
    }
    kept.push(overlay);
  }
  return kept;
}
