import { stripPeopleCounts } from "./checks";
import { agreementNotes, planChapters, themeLabel } from "./plan";
import { bestQuote, locateSpan, snapToVerbatim } from "./speech";
import type {
  BookDocument,
  BookType,
  Chapter,
  EditorEdits,
  ModelBook,
  QuoteSpan,
  SourceVoice,
} from "./types";

function stableId(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function listNames(names: string[]): string {
  const unique = names.filter(Boolean);
  if (unique.length === 0) return "These voices";
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")}, and ${unique[unique.length - 1]}`;
}

function quoteFromVoice(voice: SourceVoice, verbatim?: string): QuoteSpan {
  const source = voice.originalText.trim();
  const snapped = verbatim ? snapToVerbatim(verbatim, source) : null;
  const text =
    snapped ??
    bestQuote(source, voice.startWord || null, voice.kind);
  const span =
    voice.kind === "sourced_quote"
      ? { startMs: 0, endMs: 0 }
      : locateSpan(voice.turns, source, text, voice.durationMs);
  return {
    id: `q-${voice.id}-${stableId(text)}`,
    voiceId: voice.id,
    speakerName: voice.contributorName,
    language: voice.language,
    countryCode: voice.countryCode,
    originalText: text,
    englishText: voice.translated ? voice.englishText.trim() : voice.englishText.trim() || text,
    startMs: span.startMs,
    endMs: span.endMs,
    kind: voice.kind,
    sourceUrl: voice.sourceUrl,
    sourceTitle: voice.sourceTitle,
    sourceDate: voice.sourceDate ?? null,
    hidden: false,
    hasAudio: voice.hasAudio && voice.kind === "voice",
  };
}

function flowingProse(voices: SourceVoice[]): string {
  return voices
    .map((voice) => (voice.englishText || voice.originalText).trim().replace(/^[A-Za-z][A-Za-z'-]{1,16}\.\s+/, ""))
    .filter(Boolean)
    .join("\n\n");
}

function usableVoices(voices: SourceVoice[]): SourceVoice[] {
  return voices.filter(
    (voice) => voice.status === "READY" && !voice.hidden && voice.originalText.trim().length > 0,
  );
}

export function assembleBook(input: {
  title: string;
  question: string;
  bookType: string;
  voices: SourceVoice[];
  now?: string;
  provider?: string;
  model?: string;
}): BookDocument {
  const voices = usableVoices(input.voices);
  const plans = planChapters(voices, input.bookType);
  const byId = new Map(voices.map((voice) => [voice.id, voice]));
  const famous = input.bookType === "FAMOUS";
  const chapters: Chapter[] = plans.map((plan, index) => {
    const group = plan.voiceIds.map((id) => byId.get(id)).filter((voice): voice is SourceVoice => Boolean(voice));
    const notes = agreementNotes(group.map((voice) => voice.englishText || voice.originalText));
    return {
      id: `ch-${index + 1}-${stableId(plan.voiceIds.join(":"))}`,
      title: plan.theme,
      theme: plan.theme,
      narrative: flowingProse(group),
      agreement: notes.agreement,
      disagreement: notes.disagreement,
      quotes: group.map((voice) => quoteFromVoice(voice)),
    };
  });

  return {
    title: input.title,
    question: input.question,
    bookType: input.bookType,
    preface: famous
      ? "This book is built only from public, sourced quotations. Every quotation keeps the link it was copied from. No famous voice was cloned or synthesized."
      : "This book is made of real voices. The sentences between quotations were written to connect them. Every quotation is verbatim, and where a recording exists it can be played back.",
    chapters,
    provider: input.provider ?? "mock",
    model: input.model ?? "local-assembly",
    generatedAt: input.now ?? new Date().toISOString(),
  };
}

export function repairModelBook(input: {
  title: string;
  question: string;
  bookType: string;
  voices: SourceVoice[];
  model: ModelBook;
  provider: string;
  modelId: string;
  now?: string;
}): BookDocument {
  const voices = usableVoices(input.voices);
  const byId = new Map(voices.map((voice) => [voice.id, voice]));
  const used = new Set<string>();
  const chapters: Chapter[] = [];

  input.model.chapters.forEach((chapter, index) => {
    const quotes: QuoteSpan[] = [];
    for (const quote of chapter.quotes) {
      const voice = byId.get(quote.voiceId);
      if (!voice) continue;
      const snapped = snapToVerbatim(quote.verbatim, voice.originalText);
      const span = quoteFromVoice(voice, snapped ?? undefined);
      if (!snapped) {
        span.originalText = bestQuote(voice.originalText, voice.startWord || null, voice.kind);
        const located =
          voice.kind === "sourced_quote"
            ? { startMs: 0, endMs: 0 }
            : locateSpan(voice.turns, voice.originalText, span.originalText, voice.durationMs);
        span.startMs = located.startMs;
        span.endMs = located.endMs;
        span.id = `q-${voice.id}-${stableId(span.originalText)}`;
      }
      quotes.push(span);
      used.add(voice.id);
    }
    if (quotes.length === 0) return;
    const group = quotes
      .map((quote) => byId.get(quote.voiceId))
      .filter((voice): voice is SourceVoice => Boolean(voice));
    const notes = agreementNotes(group.map((voice) => voice.englishText || voice.originalText));
    chapters.push({
      id: `ch-${index + 1}-${stableId(chapter.title)}`,
      title: chapter.title.trim() || themeLabel(group.map((voice) => ({ text: voice.englishText || voice.originalText }))),
      theme: chapter.theme.trim() || chapter.title.trim() || "Voices",
      narrative: stripPeopleCounts(chapter.narrative.trim()) || flowingProse(group),
      agreement: chapter.agreement?.trim() || notes.agreement,
      disagreement: chapter.disagreement?.trim() || notes.disagreement,
      quotes,
    });
  });

  const missing = voices.filter((voice) => !used.has(voice.id));
  if (missing.length > 0) {
    const notes = agreementNotes(missing.map((voice) => voice.englishText || voice.originalText));
    chapters.push({
      id: `ch-rest-${stableId(missing.map((voice) => voice.id).join(":"))}`,
      title: "Also in the room",
      theme: "Also in the room",
      narrative: flowingProse(missing),
      agreement: notes.agreement,
      disagreement: notes.disagreement,
      quotes: missing.map((voice) => quoteFromVoice(voice)),
    });
  }

  if (chapters.length === 0) {
    return assembleBook({
      title: input.title,
      question: input.question,
      bookType: input.bookType,
      voices,
      now: input.now,
      provider: input.provider,
      model: input.modelId,
    });
  }

  const famous = input.bookType === "FAMOUS";
  return {
    title: input.title,
    question: input.question,
    bookType: input.bookType as BookType,
    preface:
      input.model.preface.trim() ||
      (famous
        ? "This book is built only from public, sourced quotations. Every quotation keeps the link it was copied from."
        : "This book is made of real voices. The quotations are verbatim."),
    chapters,
    provider: input.provider,
    model: input.modelId,
    generatedAt: input.now ?? new Date().toISOString(),
  };
}

export function applyEdits(document: BookDocument, edits: EditorEdits): BookDocument {
  const byId = new Map(document.chapters.map((chapter) => [chapter.id, chapter]));
  const seen = new Set<string>();
  const chapters: Chapter[] = [];
  for (const edit of edits.chapters) {
    const current = byId.get(edit.id);
    if (!current || seen.has(edit.id)) continue;
    seen.add(edit.id);
    const hidden = new Set(edit.hiddenQuoteIds);
    chapters.push({
      ...current,
      title: edit.title.trim() || current.title,
      narrative: edit.narrative.trim() || current.narrative,
      quotes: current.quotes.map((quote) => ({ ...quote, hidden: hidden.has(quote.id) })),
    });
  }
  for (const chapter of document.chapters) {
    if (!seen.has(chapter.id)) chapters.push(chapter);
  }
  return {
    ...document,
    preface: edits.preface.trim() || document.preface,
    chapters,
  };
}

export function visibleQuotes(document: BookDocument): QuoteSpan[] {
  return document.chapters.flatMap((chapter) => chapter.quotes.filter((quote) => !quote.hidden));
}

export function parseDocument(json: string): BookDocument | null {
  try {
    const value = JSON.parse(json) as BookDocument;
    if (!value || !Array.isArray(value.chapters)) return null;
    return value;
  } catch {
    return null;
  }
}
