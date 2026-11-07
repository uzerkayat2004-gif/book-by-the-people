/**
 * The feature writer: turns many voices (tens to thousands) into one smooth book, like a magazine feature.
 *
 *   map     → Muse Spark groups each batch of voices into opinions and picks exact phrases and standouts
 *   reduce  → the batch groups are merged into book-wide clusters (again and again for very big books)
 *   plan    → the AI decides the form (chapters or one continuous piece), the order and the standouts
 *   write   → one flowing passage per section, sizes said naturally, exact phrases quoted
 *   edit    → an editor pass smooths transitions and tone
 *
 * Every count comes from code, never from the model. Every quotation is checked against the voices;
 * a quoted phrase that is not in anyone's words loses its quotation marks. Pure logic: the caller passes `ask`.
 */
import { countryByCode } from "../countries";
import { cleanStandfirst } from "./clean-standfirst";
import { planChapters } from "./plan";
import type {
  Block,
  BookDocument,
  BookOutline,
  Chapter,
  OutlineCluster,
  OutlineSection,
  OutlineStandout,
  QuoteSpan,
  SourceVoice,
} from "./types";

export type Ask = (input: {
  step: string;
  system: string;
  user: string;
  schemaName: string;
  schema: object;
  maxTokens: number;
}) => Promise<unknown>;
/** Thrown when the time for this request is nearly up. Everything done so far is saved: call again to go on. */
export class NeedsMore extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NeedsMore";
  }
}

type RunState = { groups?: LocalGroup[]; plan?: unknown; sections?: (Block[] | null)[] };

export type FeatureCache = {
  get(key: string): Promise<unknown | null>;
  put(key: string, value: unknown): Promise<void>;
};

/* ---------- small text helpers ---------- */

const QUOTES = /[\u201C\u201D\u201E\u00AB\u00BB"]/g;
export function norm(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(QUOTES, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The exact words in `source` that match `phrase` (ignoring case, curly quotes and spacing), or null. */
export function exactIn(phrase: string, source: string): string | null {
  const want = norm(phrase).replace(/^["'.,;: ]+|["'.,;: ]+$/g, "");
  if (want.length < 2) return null;
  const hay = norm(source);
  const at = hay.indexOf(want);
  if (at < 0) return null;
  // Map back to the original string: walk both with the same normalisation.
  const map: number[] = [];
  let built = "";
  const flat = source.normalize("NFC");
  for (let i = 0; i < flat.length; i += 1) {
    const ch = flat[i];
    const piece = /\s/.test(ch) ? " " : norm(ch) || ch.toLowerCase();
    if (piece === " " && (built.endsWith(" ") || built.length === 0)) continue;
    for (let k = 0; k < piece.length; k += 1) map.push(i);
    built += piece;
  }
  const start = map[at];
  const end = map[at + want.length - 1];
  if (start === undefined || end === undefined) return want;
  return flat.slice(start, end + 1);
}

const NUMBER_WORDS = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];

/** A truthful, natural way to say how many: never more than the real number. */
export function sizeHint(count: number, total: number): string {
  const share = total ? count / total : 0;
  let amount: string;
  if (count <= 12) amount = NUMBER_WORDS[count] || String(count);
  else if (count < 100) {
    const down = Math.floor(count / 10) * 10;
    amount =
      count - down >= 7
        ? `nearly ${down + 10}`
        : count === down
          ? `${count}`
          : `more than ${down}`;
  } else {
    const step = count < 1000 ? 100 : 1000;
    const down = Math.floor(count / step) * step;
    amount =
      (count - down) / step >= 0.8
        ? `nearly ${(down + step).toLocaleString("en")}`
        : count === down
          ? `${count.toLocaleString("en")}`
          : `more than ${down.toLocaleString("en")}`;
  }
  let part = "";
  if (share >= 0.9) part = "nearly everyone";
  else if (share >= 0.66) part = "most of you";
  else if (share > 0.5) part = "more than half";
  else if (share >= 0.45) part = "about half";
  else if (share >= 0.3) part = "about a third";
  else if (share >= 0.22) part = "about one in four";
  else if (share >= 0.18) part = "about one in five";
  else if (share >= 0.09) part = "about one in ten";
  else if (count > 1) part = "a few";
  else part = "one person";
  return `${amount} of ${total} (${part})`;
}

/* ---------- voices as the model sees them ---------- */

export type Card = {
  ref: string;
  id: string;
  name: string;
  place: string;
  text: string;
  notable: boolean;
  country: string | null;
};

const placeOf = (voice: SourceVoice) =>
  [voice.region?.trim(), countryByCode(voice.countryCode)?.name]
    .filter(Boolean)
    .join(", ");
const bookText = (voice: SourceVoice) =>
  (voice.englishText || voice.originalText).replace(/\s+/g, " ").trim();

export function cardsOf(voices: SourceVoice[]): Card[] {
  return voices.map((voice, index) => ({
    ref: `v${index + 1}`,
    id: voice.id,
    // An unverified famous name is never shown to the writer: it can't be presented as that person.
    name:
      voice.nameUnverified && !voice.notable
        ? ""
        : voice.contributorName.trim(),
    place: placeOf(voice),
    text: bookText(voice).slice(0, 900),
    notable: Boolean(voice.notable),
    country: voice.countryCode,
  }));
}

export function batches(
  cards: Card[],
  maxCount = 60,
  maxChars = 26_000,
): Card[][] {
  const out: Card[][] = [];
  let current: Card[] = [];
  let size = 0;
  for (const card of cards) {
    if (
      current.length &&
      (current.length >= maxCount || size + card.text.length > maxChars)
    ) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(card);
    size += card.text.length + 40;
  }
  if (current.length) out.push(current);
  return out;
}

/* ---------- 1. map ---------- */

export const MAP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["groups"],
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "summary", "refs", "phrases", "standouts"],
        properties: {
          label: { type: "string" },
          summary: { type: "string" },
          refs: { type: "array", items: { type: "string" } },
          phrases: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["ref", "text"],
              properties: { ref: { type: "string" }, text: { type: "string" } },
            },
          },
          standouts: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["ref", "text", "why"],
              properties: {
                ref: { type: "string" },
                text: { type: "string" },
                why: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
};

export type LocalGroup = {
  gid: string;
  label: string;
  summary: string;
  ids: string[];
  phrases: { voiceId: string; text: string }[];
  standouts: { voiceId: string; text: string; why: string }[];
};

export function mapPrompt(
  question: string,
  batch: Card[],
  languageName: string,
) {
  const system = [
    "You read contributions to a crowd-written book that answers one question. Group them by the opinion or theme they express.",
    `Write label (3 to 6 words) and summary (one sentence) in ${languageName}.`,
    "Rules:",
    "- Every ref appears in exactly one group. Put people who say essentially the same thing together, even if they word it differently.",
    "- A clear minority or opposing view gets its own group, even if only one person holds it.",
    "- phrases: up to 3 short vivid phrases per group (3 to 14 words), copied EXACTLY from that person's text, with their ref.",
    "- standouts: only contributions whose view is exceptional, surprising, distinctive or beautifully put (at most 1 in 8 of the batch; a notable person always counts). text is one or two full sentences copied EXACTLY from their text.",
    "- Never change or invent words inside phrases or standouts.",
  ].join("\n");
  const user = JSON.stringify({
    question,
    contributions: batch.map((c) => ({
      ref: c.ref,
      place: c.place || undefined,
      notable: c.notable || undefined,
      text: c.text,
    })),
  });
  return { system, user };
}

type RawGroup = {
  label?: unknown;
  summary?: unknown;
  refs?: unknown;
  phrases?: unknown;
  standouts?: unknown;
};

export function parseMap(
  raw: unknown,
  batch: Card[],
  batchIndex: number,
): LocalGroup[] {
  const byRef = new Map(batch.map((c) => [c.ref, c]));
  const groups = Array.isArray((raw as { groups?: unknown })?.groups)
    ? (raw as { groups: RawGroup[] }).groups
    : null;
  if (!groups || !groups.length)
    throw new Error("The grouping came back empty.");
  const seen = new Set<string>();
  const out: LocalGroup[] = [];
  groups.forEach((group, index) => {
    const refs = (Array.isArray(group.refs) ? group.refs : [])
      .map(String)
      .filter((ref) => byRef.has(ref) && !seen.has(ref));
    refs.forEach((ref) => seen.add(ref));
    if (!refs.length) return;
    const inGroup = new Set(refs);
    const phrases = (Array.isArray(group.phrases) ? group.phrases : [])
      .map((p: { ref?: unknown; text?: unknown }) => {
        const card = byRef.get(String(p?.ref));
        const text =
          card && typeof p?.text === "string"
            ? exactIn(p.text, card.text)
            : null;
        return card && text && text.split(/\s+/).length <= 18
          ? { voiceId: card.id, text }
          : null;
      })
      .filter((p): p is { voiceId: string; text: string } => Boolean(p))
      .slice(0, 3);
    const standouts = (Array.isArray(group.standouts) ? group.standouts : [])
      .map((s: { ref?: unknown; text?: unknown; why?: unknown }) => {
        const card = byRef.get(String(s?.ref));
        const text =
          card && typeof s?.text === "string"
            ? exactIn(s.text, card.text)
            : null;
        return card && text && inGroup.has(card.ref)
          ? { voiceId: card.id, text, why: String(s.why ?? "").slice(0, 200) }
          : null;
      })
      .filter((s): s is { voiceId: string; text: string; why: string } =>
        Boolean(s),
      );
    out.push({
      gid: `b${batchIndex}g${index}`,
      label:
        String(group.label ?? "")
          .trim()
          .slice(0, 80) || "Other thoughts",
      summary: String(group.summary ?? "")
        .trim()
        .slice(0, 400),
      ids: refs.map((ref) => byRef.get(ref)!.id),
      phrases,
      standouts,
    });
  });
  // Anyone the model skipped is still counted, in a small group of their own.
  const missing = batch.filter((c) => !seen.has(c.ref));
  if (missing.length)
    out.push({
      gid: `b${batchIndex}gx`,
      label: "Other thoughts",
      summary: "",
      ids: missing.map((c) => c.id),
      phrases: [],
      standouts: [],
    });
  if (!out.length) throw new Error("The grouping came back empty.");
  return out;
}

/** Without a model (or after it keeps failing): word-overlap grouping, so nobody is lost. */
export function plainMap(
  batch: Card[],
  voices: Map<string, SourceVoice>,
  batchIndex: number,
): LocalGroup[] {
  const list = batch
    .map((c) => voices.get(c.id))
    .filter((v): v is SourceVoice => Boolean(v));
  return planChapters(list, "OPEN").map((plan, index) => ({
    gid: `b${batchIndex}p${index}`,
    label: plan.theme,
    summary: "",
    ids: plan.voiceIds,
    phrases: [],
    standouts: [],
  }));
}

/* ---------- 2. reduce ---------- */

export const REDUCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["clusters"],
  properties: {
    clusters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "summary", "gids"],
        properties: {
          label: { type: "string" },
          summary: { type: "string" },
          gids: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

export function reducePrompt(
  question: string,
  groups: LocalGroup[],
  languageName: string,
) {
  const system = [
    "These are groups of opinions found in separate batches of contributions to one book. Merge groups that express the same opinion into one cluster.",
    `Write each cluster's label (3 to 6 words) and summary (one or two sentences) in ${languageName}.`,
    "Rules: every gid in exactly one cluster. Keep genuinely different opinions apart, and keep minority or opposing views as their own cluster even when small. Do not merge just because the topic is similar: merge when the view is the same.",
  ].join("\n");
  const user = JSON.stringify({
    question,
    groups: groups.map((g) => ({
      gid: g.gid,
      size: g.ids.length,
      label: g.label,
      summary: g.summary,
      says: g.phrases.slice(0, 2).map((p) => p.text),
    })),
  });
  return { system, user };
}

export function parseReduce(
  raw: unknown,
  groups: LocalGroup[],
  level: number,
): LocalGroup[] {
  const byGid = new Map(groups.map((g) => [g.gid, g]));
  const list = Array.isArray((raw as { clusters?: unknown })?.clusters)
    ? (
        raw as {
          clusters: { label?: unknown; summary?: unknown; gids?: unknown }[];
        }
      ).clusters
    : null;
  if (!list || !list.length) throw new Error("The merge came back empty.");
  const seen = new Set<string>();
  const out: LocalGroup[] = [];
  list.forEach((cluster, index) => {
    const members = (Array.isArray(cluster.gids) ? cluster.gids : [])
      .map(String)
      .filter((gid) => byGid.has(gid) && !seen.has(gid));
    members.forEach((gid) => seen.add(gid));
    if (!members.length) return;
    const parts = members.map((gid) => byGid.get(gid)!);
    out.push(
      mergeGroups(
        `r${level}c${index}`,
        String(cluster.label ?? "")
          .trim()
          .slice(0, 80) || parts[0].label,
        String(cluster.summary ?? "")
          .trim()
          .slice(0, 500) || parts[0].summary,
        parts,
      ),
    );
  });
  for (const group of groups) if (!seen.has(group.gid)) out.push(group);
  return out;
}

function mergeGroups(
  gid: string,
  label: string,
  summary: string,
  parts: LocalGroup[],
): LocalGroup {
  // Phrases and standouts from the biggest groups first.
  const sorted = [...parts].sort((a, b) => b.ids.length - a.ids.length);
  return {
    gid,
    label,
    summary,
    ids: parts.flatMap((p) => p.ids),
    phrases: sorted.flatMap((p) => p.phrases).slice(0, 12),
    standouts: sorted.flatMap((p) => p.standouts).slice(0, 8),
  };
}

/* ---------- clusters with true counts ---------- */

export function toClusters(
  groups: LocalGroup[],
  voices: Map<string, SourceVoice>,
  total: number,
): OutlineCluster[] {
  return [...groups]
    .sort((a, b) => b.ids.length - a.ids.length)
    .map((group, index) => {
      const countries = new Map<string, number>();
      for (const id of group.ids) {
        const code = voices.get(id)?.countryCode;
        if (code) countries.set(code, (countries.get(code) ?? 0) + 1);
      }
      return {
        id: `c${index + 1}`,
        label: group.label,
        summary: group.summary,
        count: group.ids.length,
        share: total ? Math.round((group.ids.length / total) * 1000) / 1000 : 0,
        countries: [...countries.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([code, count]) => ({ code, count })),
        phrases: group.phrases.slice(0, 9),
        voiceIds: group.ids,
      };
    });
}

export function standoutPool(
  groups: LocalGroup[],
  voices: Map<string, SourceVoice>,
  cards: Map<string, Card>,
): OutlineStandout[] {
  const out = new Map<string, OutlineStandout>();
  // Verified notable people always qualify, first.
  for (const card of cards.values()) {
    if (!card.notable) continue;
    const voice = voices.get(card.id)!;
    out.set(card.id, {
      voiceId: card.id,
      name: card.name,
      place: card.place,
      text: firstSentences(bookText(voice)),
      why: "Verified notable person",
      notable: true,
    });
  }
  for (const group of groups) {
    for (const s of group.standouts) {
      if (out.has(s.voiceId)) continue;
      const card = cards.get(s.voiceId);
      if (!card) continue;
      out.set(s.voiceId, {
        voiceId: s.voiceId,
        name: card.name,
        place: card.place,
        text: s.text,
        why: s.why,
        notable: false,
      });
    }
  }
  return [...out.values()];
}

function firstSentences(text: string, max = 260): string {
  const parts = text.split(/(?<=[.!?。！？])\s+/u);
  let out = "";
  for (const part of parts) {
    if (out && (out + " " + part).length > max) break;
    out = out ? `${out} ${part}` : part;
  }
  return out.slice(0, max * 1.5);
}

/* ---------- 3. plan ---------- */

export const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["form", "arc", "standfirst", "preface", "sections"],
  properties: {
    form: { type: "string", enum: ["chapters", "continuous"] },
    arc: { type: "string" },
    standfirst: { type: "string" },
    preface: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "role", "purpose", "clusterIds", "standoutRefs"],
        properties: {
          title: { type: "string" },
          role: {
            type: "string",
            enum: ["hook", "build", "contrast", "resolution", "closing"],
          },
          purpose: { type: "string" },
          clusterIds: { type: "array", items: { type: "string" } },
          standoutRefs: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

export function maxStandouts(total: number) {
  return Math.max(2, Math.min(12, Math.round(total / 10)));
}

export function planPrompt(input: {
  title: string;
  question: string;
  total: number;
  countries: number;
  clusters: OutlineCluster[];
  pool: OutlineStandout[];
  languageName: string;
}) {
  const system = [
    "You are the editor of a documentary-style book in which many people answer one question. Plan its structure.",
    `Write titles, purpose, arc, standfirst and preface in ${input.languageName}.`,
    "Decide the FORM:",
    '- "continuous": one flowing piece with no chapter headings. Choose it when most people say the same thing (for example the biggest cluster holds 70% or more and the rest are small variations or a few dissenters).',
    '- "chapters": choose it when the voices fall into several distinct themes or opinions of real size. Give each chapter a short, evocative title (2 to 6 words, never "Chapter 1").',
    "Decide the ORDER like a good feature or documentary: an opening hook (a vivid, surprising or notable voice, or the big picture), build-up through the main views, contrast or disagreement, then resolution and a closing that recaps and ends on a memorable line.",
    "Sections: continuous form uses 2 to 5 movements (their titles are internal only); chapters form uses 2 to 8 chapters. Every cluster id appears in at least one section. The biggest cluster may be spread over more than one section.",
    `Standouts: pick at most ${maxStandouts(input.total)} refs from the standout pool in total, at most 3 per section, only voices whose view is exceptional or distinctive. Notable people (notable: true) are always used and always placed in the FIRST section. Never describe anyone as famous unless notable is true.`,
    "standfirst: one sentence that hooks the reader.",
    "preface: two short sentences that welcome the listener and hook them into the story. Do not mention how many people or countries took part, and do not mention that quotations are exact.",
    'purpose: one short sentence a reader would see under the chapter title, saying what that chapter is about. Never write editorial directions such as "Open with", "Build through", or "End on".',
    "arc: one or two sentences describing the story the book tells.",
  ].join("\n");
  const user = JSON.stringify({
    title: input.title,
    question: input.question,
    totalVoices: input.total,
    countries: input.countries,
    clusters: input.clusters.map((c) => ({
      id: c.id,
      label: c.label,
      summary: c.summary,
      count: c.count,
      share: `${Math.round(c.share * 100)}%`,
      topCountries: c.countries.map(
        (x) => `${countryByCode(x.code)?.name ?? x.code} (${x.count})`,
      ),
      says: c.phrases.slice(0, 3).map((p) => p.text),
    })),
    standoutPool: input.pool.map((s, index) => ({
      ref: `s${index + 1}`,
      name: s.name || "(name withheld)",
      place: s.place,
      notable: s.notable,
      cluster: undefined,
      text: s.text,
      why: s.why,
    })),
  });
  return { system, user };
}

export function parsePlan(
  raw: unknown,
  clusters: OutlineCluster[],
  pool: OutlineStandout[],
  total: number,
): {
  form: BookOutline["form"];
  arc: string;
  standfirst: string;
  preface: string;
  sections: OutlineSection[];
} {
  const data = raw as {
    form?: unknown;
    arc?: unknown;
    standfirst?: unknown;
    preface?: unknown;
    sections?: unknown;
  };
  const list = Array.isArray(data?.sections)
    ? (data.sections as {
        title?: unknown;
        role?: unknown;
        purpose?: unknown;
        clusterIds?: unknown;
        standoutRefs?: unknown;
      }[])
    : [];
  if (!list.length) throw new Error("The plan came back without sections.");
  const known = new Set(clusters.map((c) => c.id));
  const refToId = new Map(pool.map((s, index) => [`s${index + 1}`, s.voiceId]));
  const used = new Set<string>();
  const cap = maxStandouts(total);
  let picked = 0;
  const sections: OutlineSection[] = list.slice(0, 8).map((item, index) => {
    const clusterIds = [
      ...new Set(
        (Array.isArray(item.clusterIds) ? item.clusterIds : [])
          .map(String)
          .filter((id) => known.has(id)),
      ),
    ];
    const standoutIds: string[] = [];
    for (const ref of Array.isArray(item.standoutRefs)
      ? item.standoutRefs.map(String)
      : []) {
      const id = refToId.get(ref);
      if (!id || used.has(id) || standoutIds.length >= 3 || picked >= cap)
        continue;
      used.add(id);
      standoutIds.push(id);
      picked += 1;
    }
    return {
      id: `s${index + 1}`,
      title: String(item.title ?? "")
        .trim()
        .slice(0, 90),
      role: String(item.role ?? "build"),
      purpose: String(item.purpose ?? "")
        .trim()
        .slice(0, 400),
      clusterIds,
      standoutIds,
    };
  });
  const form = data?.form === "continuous" ? "continuous" : "chapters";
  // Chapters tell each view once: a repeated cluster stays only where it first appears.
  if (form === "chapters") {
    const told = new Set<string>();
    for (const section of sections) {
      section.clusterIds = section.clusterIds.filter((id) => !told.has(id));
      section.clusterIds.forEach((id) => told.add(id));
    }
  }
  // Every cluster is told somewhere: a forgotten one joins the section before the closing.
  const covered = new Set(sections.flatMap((s) => s.clusterIds));
  for (const cluster of clusters) {
    if (covered.has(cluster.id)) continue;
    const target =
      sections.length > 1 ? sections[sections.length - 2] : sections[0];
    target.clusterIds.push(cluster.id);
  }
  // Verified notable people open the book.
  const notable = pool.filter((s) => s.notable).map((s) => s.voiceId);
  for (const id of notable) {
    for (const section of sections)
      section.standoutIds = section.standoutIds.filter((x) => x !== id);
    sections[0].standoutIds.unshift(id);
  }
  sections.forEach((section, index) => {
    if (!section.title)
      section.title =
        clusters.find((c) => c.id === section.clusterIds[0])?.label ??
        `Part ${index + 1}`;
  });
  return {
    form,
    arc: String(data?.arc ?? "")
      .trim()
      .slice(0, 600),
    standfirst: cleanStandfirst(String(data?.standfirst ?? ""))
      .trim()
      .slice(0, 300),
    preface: String(data?.preface ?? "")
      .trim()
      .slice(0, 600),
    sections: sections.filter(
      (section, index) =>
        index === 0 ||
        section.clusterIds.length ||
        section.standoutIds.length ||
        section.role === "closing",
    ),
  };
}

/** Without a model: one section per cluster, biggest first, the whole thing continuous when one view dominates. */
export function plainPlan(clusters: OutlineCluster[], pool: OutlineStandout[]) {
  const continuous = clusters.length === 1 || (clusters[0]?.share ?? 0) >= 0.7;
  const sections: OutlineSection[] = clusters
    .slice(0, 8)
    .map((c, index) => ({
      id: `s${index + 1}`,
      title: c.label,
      role: index === 0 ? "hook" : "build",
      purpose: c.summary,
      clusterIds: [c.id],
      standoutIds: [],
    }));
  for (const c of clusters.slice(8))
    sections[sections.length - 1].clusterIds.push(c.id);
  pool.forEach((s, index) => {
    const at = s.notable
      ? 0
      : Math.max(
          0,
          sections.findIndex((x) =>
            x.clusterIds.some((id) =>
              clusters.find((c) => c.id === id)?.voiceIds.includes(s.voiceId),
            ),
          ),
        );
    if (sections[at] && sections[at].standoutIds.length < 3 && index < 12)
      sections[at].standoutIds.push(s.voiceId);
  });
  return {
    form: continuous ? ("continuous" as const) : ("chapters" as const),
    arc: "",
    standfirst: "",
    preface: "",
    sections,
  };
}

/* ---------- 4. write ---------- */

export const WRITE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["blocks"],
  properties: {
    blocks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "text", "ref", "cluster"],
        properties: {
          type: { type: "string", enum: ["p", "quote"] },
          text: { type: "string" },
          ref: { type: "string" },
          cluster: { type: "string" },
        },
      },
    },
  },
};

export const NARRATOR =
  "Voice: one warm, observant narrator, like a documentary or a long magazine feature. Plain words, varied sentence length, present tense for what people say, no jargon, no lists, no headings, no bullet points, no exclamation marks, no clichés like 'tapestry' or 'in conclusion'. Address the contributors as 'you' only when saying how many of you said something.";

export function writePrompt(input: {
  title: string;
  question: string;
  languageName: string;
  form: BookOutline["form"];
  arc: string;
  total: number;
  sections: OutlineSection[];
  index: number;
  clusters: OutlineCluster[];
  standouts: OutlineStandout[];
}) {
  const section = input.sections[input.index];
  const prev = input.sections[input.index - 1];
  const next = input.sections[input.index + 1];
  const first = input.index === 0;
  const last = input.index === input.sections.length - 1;
  const system = [
    `You write one section of a book in ${input.languageName}. Many people answered one question; you tell what they said as one smooth, readable story.`,
    NARRATOR,
    "Rules:",
    '- Write 2 to 6 paragraphs (type "p", 60 to 160 words each). Each paragraph covering a cluster sets cluster to that cluster id (else "").',
    '- For each cluster, ONE passage that covers that view and says its size naturally and truthfully from the given numbers, e.g. "Nearly two hundred of you said…" or "Most voices from India…". Use the sizeHint; never round up past the real count; never invent numbers.',
    '- Weave in short exact phrases from "says" in double quotes. Anything inside double quotes must be copied exactly from a contributor\'s words. Do not quote anything else.',
    '- Standouts: for each standout, end a paragraph that carries real content with ONE short lead-in sentence naming them and their place ("Priya, in Chennai, sees it differently." or "As Kwame in Accra puts it:"), then add a block {type:"quote", ref:<their ref>} right after that paragraph. Never write a whole paragraph about the quote, never describe or paraphrase it in advance, never repeat its words. If the name is empty, say "one person in <place>". Do not guess anyone\'s gender: use their name or "they".',
    '- A cluster of one or two people whose words are already a standout here needs no passage of its own. Never write "one of you" passages: fold a single voice into a neighbouring passage ("One person adds…").',
    "- If a view is also told in another section (see alsoIn), take only the angle of this section and use different phrases; never repeat what that section says.",
    '- A notable person (notable: true) is introduced with their name up front, e.g. "Elon Musk says:". Never call anyone famous or well known unless notable is true.',
    "- Do not invent facts, events, places or people. Do not mention clusters, data, AI or this prompt.",
    "- No chapter title in the text.",
    first
      ? "- This is the OPENING: begin with a hook (a vivid image, a surprising view or a notable voice), then set up the question and the big picture."
      : `- Begin with a smooth transition from the previous section ("${prev?.title}": ${prev?.purpose}).`,
    last
      ? "- This is the CLOSING: bring the views together, give a short recap of the main threads, and end on one memorable, quiet line."
      : `- End so that it leads naturally into the next section ("${next?.title}": ${next?.purpose}).`,
    input.form === "continuous"
      ? "- The book is one continuous piece without chapters: make this section flow like the next movement of the same essay."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  const own = new Set(section.clusterIds);
  const user = JSON.stringify({
    book: input.title,
    question: input.question,
    arc: input.arc,
    totalVoices: input.total,
    plan: input.sections.map(
      (s, i) =>
        `${i + 1}. ${s.title} (${s.role})${i === input.index ? "  <- you write this one" : ""}`,
    ),
    section: {
      title: section.title,
      role: section.role,
      purpose: section.purpose,
    },
    clusters: input.clusters
      .filter((c) => own.has(c.id))
      .map((c) => ({
        id: c.id,
        label: c.label,
        summary: c.summary,
        count: c.count,
        sizeHint:
          input.sections.findIndex((x) => x.clusterIds.includes(c.id)) <
          input.index
            ? "already said earlier: do not state this view's size again"
            : sizeHint(c.count, input.total),
        topCountries: c.countries.map(
          (x) => `${countryByCode(x.code)?.name ?? x.code}: ${x.count}`,
        ),
        says: phraseShare(c, input.sections, input.index),
        alsoIn: input.sections
          .filter((s, i) => i !== input.index && s.clusterIds.includes(c.id))
          .map((s) => s.title),
      })),
    standouts: section.standoutIds
      .map((id) => input.standouts.find((s) => s.voiceId === id))
      .filter((s): s is OutlineStandout => Boolean(s))
      .map((s) => ({
        ref: s.voiceId,
        name: s.name,
        place: s.place,
        notable: s.notable,
        quote: s.text,
      })),
  });
  return { system, user };
}

/** A view told in several sections hands each one different phrases. */
function phraseShare(
  cluster: OutlineCluster,
  sections: OutlineSection[],
  index: number,
): string[] {
  const holders = sections
    .map((s, i) => (s.clusterIds.includes(cluster.id) ? i : -1))
    .filter((i) => i >= 0);
  const texts = cluster.phrases.map((p) => p.text);
  if (holders.length <= 1) return texts;
  const slot = holders.indexOf(index);
  return texts.filter((_, i) => i % holders.length === slot);
}

/** Removes quotation marks around anything that is not in somebody's words. */
export function guardQuotes(text: string, corpus: string[]): string {
  const hay = corpus.map(norm);
  return text.replace(
    /(["\u201C])([^"\u201C\u201D]{2,400})(["\u201D])/g,
    (whole, _open: string, inner: string) => {
      const want = norm(inner).replace(/^[.,;: ]+|[.,;: ]+$/g, "");
      if (want.length >= 2 && hay.some((h) => h.includes(want)))
        return `\u201C${inner}\u201D`;
      return inner;
    },
  );
}

const tidy = (text: string) =>
  text
    .replace(/[*#`_]{1,3}/g, "")
    .replace(/\s+/g, " ")
    .trim();

export function parseSection(
  raw: unknown,
  section: OutlineSection,
  corpus: string[],
  clusterIds: Set<string>,
): Block[] {
  const list = Array.isArray((raw as { blocks?: unknown })?.blocks)
    ? (
        raw as {
          blocks: {
            type?: unknown;
            text?: unknown;
            ref?: unknown;
            cluster?: unknown;
          }[];
        }
      ).blocks
    : null;
  if (!list) throw new Error("The section came back empty.");
  const blocks: Block[] = [];
  const quoted = new Set<string>();
  for (const item of list) {
    if (item.type === "quote") {
      const id = String(item.ref ?? "");
      if (section.standoutIds.includes(id) && !quoted.has(id)) {
        quoted.add(id);
        blocks.push({ kind: "quote", quoteId: id });
      }
      continue;
    }
    const text = guardQuotes(tidy(String(item.text ?? "")), corpus);
    if (!text) continue;
    const cluster = clusterIds.has(String(item.cluster))
      ? String(item.cluster)
      : undefined;
    blocks.push(cluster ? { kind: "p", text, cluster } : { kind: "p", text });
  }
  if (!blocks.some((b) => b.kind === "p"))
    throw new Error("The section came back empty.");
  // A standout the writer forgot is still quoted, at the end of its section.
  for (const id of section.standoutIds)
    if (!quoted.has(id)) blocks.push({ kind: "quote", quoteId: id });
  return blocks;
}

/** Without a model: a plain passage per cluster, honest about size, with its standouts. */
export function plainSection(
  section: OutlineSection,
  clusters: OutlineCluster[],
  standouts: OutlineStandout[],
  total: number,
): Block[] {
  const blocks: Block[] = [];
  for (const id of section.clusterIds) {
    const c = clusters.find((x) => x.id === id);
    if (!c) continue;
    const says = c.phrases.slice(0, 2).map((p) => `\u201C${p.text}\u201D`);
    blocks.push({
      kind: "p",
      cluster: c.id,
      text: `${capital(sizeHint(c.count, total).replace(/ \(.*\)$/, ""))} voices spoke of ${c.label.toLowerCase()}.${c.summary ? ` ${c.summary}` : ""}${says.length ? ` In their words: ${says.join(", ")}.` : ""}`,
    });
  }
  for (const id of section.standoutIds) {
    const s = standouts.find((x) => x.voiceId === id);
    if (!s) continue;
    blocks.push({
      kind: "p",
      text: `${s.name || "One person"}${s.place ? `, in ${s.place},` : ""} put it this way.`,
    });
    blocks.push({ kind: "quote", quoteId: id });
  }
  return blocks;
}

const capital = (text: string) =>
  text ? text.charAt(0).toUpperCase() + text.slice(1) : text;

/* ---------- 5. edit ---------- */

export const EDIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["paragraphs", "titles"],
  properties: {
    paragraphs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "text"],
        properties: { id: { type: "string" }, text: { type: "string" } },
      },
    },
    titles: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title"],
        properties: { id: { type: "string" }, title: { type: "string" } },
      },
    },
  },
};

export function editPrompt(input: {
  title: string;
  languageName: string;
  form: BookOutline["form"];
  sections: { id: string; title: string; blocks: Block[] }[];
  standouts: OutlineStandout[];
}) {
  const system = [
    `You are the final editor of a book in ${input.languageName}. Read it as one piece and fix its flow.`,
    NARRATOR,
    "Fix: abrupt topic jumps, missing or clumsy transitions between paragraphs and sections, repeated openings or phrases, tone or tense that drifts, a weak first line or a weak last line.",
    "Return ONLY the paragraphs you changed, by id, with their full new text. Keep each paragraph's meaning, its size statements and numbers, and every phrase in double quotes exactly as it is. Do not add facts, numbers, names or new quotations. Keep each paragraph roughly the same length.",
    input.form === "chapters"
      ? "You may also improve chapter titles (2 to 6 words, evocative, no numbers): return them in titles by section id. Otherwise return titles: []."
      : "Return titles: [].",
  ].join("\n");
  const user = JSON.stringify({
    title: input.title,
    sections: input.sections.map((s) => ({
      id: s.id,
      title: s.title,
      blocks: s.blocks.map((b, i) => {
        if (b.kind === "p") return { id: `${s.id}p${i}`, text: b.text };
        if (b.kind === "quote") {
          const who = input.standouts.find((x) => x.voiceId === b.quoteId);
          return {
            quote: `${who?.name || "someone"}: \u201C${who?.text ?? ""}\u201D`,
          };
        }
        return { break: true };
      }),
    })),
  });
  return { system, user };
}

const digits = (text: string) =>
  (text.match(/\d[\d,.]*/g) ?? [])
    .map((d) => d.replace(/[,.]$/, ""))
    .sort()
    .join("|");

export function applyEdit(
  raw: unknown,
  sections: { id: string; title: string; blocks: Block[] }[],
  corpus: string[],
  form: BookOutline["form"],
): number {
  const data = raw as {
    paragraphs?: { id?: unknown; text?: unknown }[];
    titles?: { id?: unknown; title?: unknown }[];
  };
  let changed = 0;
  const byId = new Map<string, { section: number; block: number }>();
  sections.forEach((s, si) =>
    s.blocks.forEach(
      (b, bi) =>
        b.kind === "p" && byId.set(`${s.id}p${bi}`, { section: si, block: bi }),
    ),
  );
  for (const item of Array.isArray(data?.paragraphs) ? data.paragraphs : []) {
    const at = byId.get(String(item?.id));
    if (!at) continue;
    const block = sections[at.section].blocks[at.block];
    if (block.kind !== "p") continue;
    const text = guardQuotes(tidy(String(item.text ?? "")), corpus);
    // An edit that loses half the paragraph, doubles it, or changes its numbers is not taken.
    if (
      !text ||
      text.length < block.text.length * 0.55 ||
      text.length > block.text.length * 1.8 ||
      digits(text) !== digits(block.text)
    )
      continue;
    block.text = text;
    changed += 1;
  }
  if (form === "chapters") {
    for (const item of Array.isArray(data?.titles) ? data.titles : []) {
      const section = sections.find((s) => s.id === String(item?.id));
      const title = tidy(String(item?.title ?? "")).replace(
        /^chapter\s+\d+[:.]?\s*/i,
        "",
      );
      if (section && title && title.length <= 80 && !/\d/.test(title))
        section.title = title;
    }
  }
  return changed;
}

/* ---------- the book ---------- */

function stableId(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function standoutQuote(
  voice: SourceVoice,
  standout: OutlineStandout,
): QuoteSpan {
  const translated = Boolean(
    voice.translated &&
    voice.englishText &&
    voice.englishText !== voice.originalText,
  );
  return {
    id: `q-${voice.id}-${stableId(standout.text)}`,
    voiceId: voice.id,
    speakerName:
      standout.name ||
      (standout.place ? `A voice from ${standout.place}` : "A contributor"),
    language: voice.language,
    countryCode: voice.countryCode,
    originalText: translated ? voice.originalText.trim() : standout.text,
    englishText: standout.text,
    startMs: 0,
    endMs: 0,
    kind: voice.kind,
    sourceUrl: voice.sourceUrl,
    sourceTitle: voice.sourceTitle,
    sourceDate: voice.sourceDate ?? null,
    hidden: false,
    hasAudio: false,
  };
}

export function toDocument(input: {
  title: string;
  question: string;
  bookType: string;
  language: string;
  outline: BookOutline;
  standfirst: string;
  preface: string;
  sections: { id: string; title: string; blocks: Block[] }[];
  voices: Map<string, SourceVoice>;
  provider: string;
  model: string;
  now?: string;
}): BookDocument {
  const { outline } = input;
  const quoteFor = (id: string) => {
    const voice = input.voices.get(id);
    const standout = outline.standouts.find((s) => s.voiceId === id);
    return voice && standout ? standoutQuote(voice, standout) : null;
  };
  const chapterOf = (
    id: string,
    title: string,
    theme: string,
    blocks: Block[],
    clusterIds: string[],
  ): Chapter => {
    const quotes: QuoteSpan[] = [];
    const out: Block[] = [];
    for (const block of blocks) {
      if (block.kind !== "quote") {
        out.push(block);
        continue;
      }
      const quote = quoteFor(block.quoteId);
      if (!quote) continue;
      quotes.push(quote);
      out.push({ kind: "quote", quoteId: quote.id });
    }
    const ids = new Set(
      clusterIds.flatMap(
        (cid) => outline.clusters.find((c) => c.id === cid)?.voiceIds ?? [],
      ),
    );
    return {
      id,
      title,
      theme,
      narrative: out
        .flatMap((b) => (b.kind === "p" ? [b.text] : []))
        .join("\n\n"),
      agreement: null,
      disagreement: null,
      quotes,
      blocks: out,
      voices: ids.size,
    };
  };
  const sectionOf = (s: { id: string }) =>
    outline.sections.find((x) => x.id === s.id)!;
  let chapters: Chapter[];
  if (outline.form === "continuous") {
    const blocks: Block[] = [];
    input.sections.forEach((s, index) => {
      if (index > 0) blocks.push({ kind: "break", title: s.title });
      blocks.push(...s.blocks);
    });
    chapters = [
      chapterOf(
        `ch-1-${stableId(input.title)}`,
        input.title,
        input.standfirst,
        blocks,
        outline.clusters.map((c) => c.id),
      ),
    ];
  } else {
    chapters = input.sections.map((s, index) =>
      chapterOf(
        `ch-${index + 1}-${stableId(s.title)}`,
        s.title,
        sectionOf(s).purpose,
        s.blocks,
        sectionOf(s).clusterIds,
      ),
    );
  }
  // The saved plan follows the final titles.
  for (const s of input.sections) sectionOf(s).title = s.title;
  return {
    title: input.title,
    question: input.question,
    bookType: input.bookType,
    language: input.language,
    preface: input.preface,
    standfirst: input.standfirst,
    form: outline.form,
    outline,
    chapters,
    provider: input.provider,
    model: input.model,
    generatedAt: input.now ?? new Date().toISOString(),
  };
}

/* ---------- the whole run ---------- */

async function pool<T, R>(
  items: T[],
  size: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        out[index] = await run(items[index], index);
      }
    }),
  );
  return out;
}

async function tryTwice<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch {
    return await work();
  }
}

export async function writeFeature(input: {
  title: string;
  question: string;
  bookType: string;
  language: string;
  languageName: string;
  voices: SourceVoice[];
  ask: Ask | null;
  cache?: FeatureCache;
  log?: (line: string) => void;
  concurrency?: number;
  provider: string;
  model: string;
  /** When this request must stop (ms since epoch). Work is saved in steps, so the next request goes on. */
  deadline?: number;
}): Promise<BookDocument> {
  const log = input.log ?? (() => undefined);
  const startedAt = Date.now();
  const room = () => (input.deadline ? input.deadline - Date.now() : Number.POSITIVE_INFINITY);
  // "Too little time left to start this step": at most a quarter of this request's time, so a short budget still moves on.
  const low = (ms: number) => room() < Math.min(ms, input.deadline ? (input.deadline - startedAt) / 4 : ms);
  const voices = input.voices.filter(
    (v) =>
      v.status === "READY" &&
      !v.hidden &&
      (v.englishText || v.originalText).trim(),
  );
  if (!voices.length) throw new Error("There are no voices to write from yet.");
  const byId = new Map(voices.map((v) => [v.id, v]));
  const cards = cardsOf(voices);
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const total = voices.length;
  const countries = new Set(voices.map((v) => v.countryCode).filter(Boolean))
    .size;
  const corpus = voices.map(bookText);
  const steps: string[] = [];
  const reasons = new Set<string>();
  // Why a step fell back to the built-in way, once per step and reason (never a key: API messages only).
  const why = (step: string, error: unknown) => {
    const text = `${step}: ${(error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 160)}`;
    if (reasons.has(text) || reasons.size >= 6) return;
    reasons.add(text);
    steps.push(`fallback ${text}`);
  };
  const width = input.concurrency ?? 6;
  const ask = input.ask;
  const runKey = `run-${stableId(cards.map((c) => `${c.id}:${c.text}`).join("|"))}-${input.language}`;
  const saved: RunState = ((await input.cache?.get(runKey).catch(() => null)) as RunState | null) ?? {};
  const save = () => input.cache?.put(runKey, saved).catch(() => undefined);

  // 1. map
  const parts = batches(cards);
  log(
    `Reading all ${total} voices in ${parts.length} ${parts.length === 1 ? "batch" : "batches"}.`,
  );
  let fallbackBatches = 0;
  const local = (
    await pool(parts, width, async (batch, index) => {
      const key = `map-${stableId(batch.map((c) => `${c.id}:${c.text}`).join("|"))}-${input.language}`;
      const cached = (await input.cache?.get(key).catch(() => null)) as
        LocalGroup[] | null;
      if (cached && Array.isArray(cached))
        return cached.map((g, gi) => ({ ...g, gid: `b${index}g${gi}` }));
      // Not enough time left in this request: leave the batch for the next one.
      if (ask && low(75_000)) return null;
      let groups: LocalGroup[];
      if (ask) {
        try {
          groups = await tryTwice(async () =>
            parseMap(
              await ask({
                step: "map",
                ...mapPrompt(input.question, batch, input.languageName),
                schemaName: "voice_groups",
                schema: MAP_SCHEMA,
                maxTokens: 9000,
              }),
              batch,
              index,
            ),
          );
          await input.cache?.put(key, groups).catch(() => undefined);
        } catch (error) {
          fallbackBatches += 1;
          why("map", error);
          groups = plainMap(batch, byId, index);
        }
      } else groups = plainMap(batch, byId, index);
      return groups;
    })
  );
  const unread = local.filter((g) => !g).length;
  if (unread) throw new NeedsMore(`Read ${parts.length - unread} of ${parts.length} batches of voices.`);
  const localGroups = (local as LocalGroup[][]).flat();
  steps.push(
    `map: ${parts.length} batches, ${localGroups.length} groups${fallbackBatches ? `, ${fallbackBatches} grouped by word overlap` : ""}`,
  );

  // 2. reduce, in rounds, until one call can see every group.
  let groups = localGroups;
  let level = 0;
  let reduceFell = false;
  if (saved.groups?.length) groups = saved.groups;
  else if (ask && parts.length > 1) {
    if (low(60_000)) throw new NeedsMore("Read every voice. Merging them next.");
    while (level < 4) {
      const chunks: LocalGroup[][] = [];
      for (let i = 0; i < groups.length; i += 160)
        chunks.push(groups.slice(i, i + 160));
      log(`Merging ${groups.length} groups into book-wide opinions.`);
      const merged = (
        await pool(chunks, width, async (chunk) => {
          try {
            return await tryTwice(async () =>
              parseReduce(
                await ask({
                  step: "reduce",
                  ...reducePrompt(input.question, chunk, input.languageName),
                  schemaName: "clusters",
                  schema: REDUCE_SCHEMA,
                  maxTokens: 9000,
                }),
                chunk,
                level,
              ),
            );
          } catch (error) {
            why("reduce", error);
            reduceFell = true;
            return chunk;
          }
        })
      ).flat();
      merged.forEach((g, i) => (g.gid = `r${level}x${i}`));
      level += 1;
      const done = chunks.length === 1 || merged.length >= groups.length * 0.95;
      groups = merged;
      if (done) break;
    }
  }
  if (!saved.groups && ask && parts.length > 1 && !reduceFell) {
    saved.groups = groups;
    await save();
  }
  const clusters = toClusters(groups, byId, total);
  steps.push(
    `reduce: ${clusters.length} clusters (${clusters
      .slice(0, 4)
      .map((c) => c.count)
      .join(", ")}${clusters.length > 4 ? ", …" : ""})`,
  );
  const standoutCandidates = standoutPool(groups, byId, cardById);

  // 3. plan
  log("Planning the book's shape and order.");
  let plan: ReturnType<typeof parsePlan>;
  if (saved.plan) plan = saved.plan as ReturnType<typeof parsePlan>;
  else if (ask) {
    if (low(50_000)) throw new NeedsMore("Merged the voices. Planning the book next.");
    try {
      plan = await tryTwice(async () =>
        parsePlan(
          await ask({
            step: "plan",
            ...planPrompt({
              title: input.title,
              question: input.question,
              total,
              countries,
              clusters,
              pool: standoutCandidates,
              languageName: input.languageName,
            }),
            schemaName: "book_plan",
            schema: PLAN_SCHEMA,
            maxTokens: 8000,
          }),
          clusters,
          standoutCandidates,
          total,
        ),
      );
      saved.plan = plan;
      await save();
    } catch (error) {
      why("plan", error);
      plan = plainPlan(clusters, standoutCandidates);
      steps.push("plan: built-in (the model's plan did not come back)");
    }
  } else plan = plainPlan(clusters, standoutCandidates);
  const usedStandouts = new Set(plan.sections.flatMap((s) => s.standoutIds));
  const outline: BookOutline = {
    v: 1,
    form: plan.form,
    total,
    countries,
    arc: plan.arc,
    clusters,
    standouts: standoutCandidates.filter((s) => usedStandouts.has(s.voiceId)),
    sections: plan.sections,
    steps,
  };
  steps.push(
    `plan: ${plan.form}, ${plan.sections.length} sections, ${outline.standouts.length} standouts`,
  );

  // 4. write, every section at once (each knows its neighbours, the editor smooths the joins).
  log(
    plan.form === "continuous"
      ? "Writing one continuous piece."
      : `Writing ${plan.sections.length} chapters.`,
  );
  const clusterIds = new Set(clusters.map((c) => c.id));
  let plainSections = 0;
  const done = saved.sections ?? [];
  let skipped = 0;
  const written = await pool(plan.sections, width, async (section, index) => {
    const kept = done[index];
    if (kept) return kept;
    if (ask && low(45_000)) {
      skipped += 1;
      return [] as Block[];
    }
    if (ask) {
      try {
        const blocks = await tryTwice(async () =>
          parseSection(
            await ask({
              step: "write",
              ...writePrompt({
                title: input.title,
                question: input.question,
                languageName: input.languageName,
                form: plan.form,
                arc: plan.arc,
                total,
                sections: plan.sections,
                index,
                clusters,
                standouts: outline.standouts,
              }),
              schemaName: "book_section",
              schema: WRITE_SCHEMA,
              maxTokens: 9000,
            }),
            section,
            corpus,
            clusterIds,
          ),
        );
        done[index] = blocks;
        return blocks;
      } catch (error) {
        why("write", error);
        plainSections += 1;
      }
    }
    return plainSection(section, clusters, outline.standouts, total);
  });
  if (ask) {
    saved.sections = plan.sections.map((_, index) => done[index] ?? null);
    await save();
  }
  if (skipped) throw new NeedsMore(`Wrote ${plan.sections.length - skipped} of ${plan.sections.length} parts.`);
  const sections = plan.sections.map((s, index) => ({
    id: s.id,
    title: s.title,
    blocks: written[index],
  }));
  steps.push(
    `write: ${sections.length} sections${plainSections ? `, ${plainSections} plain` : ""}`,
  );

  // 5. editor pass over the whole book.
  if (ask && low(50_000)) throw new NeedsMore("Wrote every part. The editor reads it next.");
  if (ask) {
    log("Editor pass: reading it through for flow.");
    try {
      const raw = await ask({
        step: "edit",
        ...editPrompt({
          title: input.title,
          languageName: input.languageName,
          form: plan.form,
          sections,
          standouts: outline.standouts,
        }),
        schemaName: "book_edit",
        schema: EDIT_SCHEMA,
        maxTokens: 14000,
      });
      steps.push(
        `edit: ${applyEdit(raw, sections, corpus, plan.form)} paragraphs smoothed`,
      );
    } catch (error) {
      why("edit", error);
      steps.push("edit: skipped (the editor did not answer)");
    }
  }

  // Finished: the next Make writes afresh (the grouping stays cached per batch).
  if (ask && (saved.groups || saved.plan || saved.sections)) await input.cache?.put(runKey, {}).catch(() => undefined);
  const preface =
    plan.preface ||
    `This book was written from the words of ${total} ${total === 1 ? "person" : "people"}${countries ? ` in ${countries} ${countries === 1 ? "country" : "countries"}` : ""}. The narrator's sentences connect them; every quotation is exact.`;
  return toDocument({
    title: input.title,
    question: input.question,
    bookType: input.bookType,
    language: input.language,
    outline,
    standfirst: plan.standfirst,
    preface,
    sections,
    voices: byId,
    provider: input.provider,
    model: input.model,
  });
}

/** After a hand edit of a feature chapter's text: new paragraphs go where the old ones were, quotes stay in place. */
export function reflowBlocks(blocks: Block[], narrative: string): Block[] {
  const paragraphs = narrative
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: Block[] = [];
  let next = 0;
  for (const block of blocks) {
    if (block.kind !== "p") {
      out.push(block);
      continue;
    }
    if (next < paragraphs.length) {
      out.push({ ...block, text: paragraphs[next] });
      next += 1;
    }
  }
  for (; next < paragraphs.length; next += 1) out.push({ kind: "p", text: paragraphs[next] });
  return out;
}
