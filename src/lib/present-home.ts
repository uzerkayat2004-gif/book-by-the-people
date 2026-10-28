import { countryByCode, countryStats, flagEmoji } from "@/lib/countries";
import type { BookDocument } from "@/lib/book/types";
import { releaseLabel, stageFor, type Stage } from "@/lib/stage";
import { stripPeopleCounts } from "@/lib/book/checks";
import { chapterSummary, clip } from "@/lib/book/summary";

type Voice = {
  contributorName: string;
  countryCode: string | null;
  region?: string;
  status: string;
  hidden: boolean;
  id: string;
  storageKey: string | null;
  kind: string;
};

export function presentHome(input: {
  status: string;
  stageOverride?: string | null;
  question: string;
  closesAt: Date | null;
  publishedAt: Date | null;
  voices: Voice[];
  slug: string;
  paused: boolean;
  voiceHref: string | null;
  document: BookDocument | null;
  pollQuestion: string;
  poll: { id: string; label: string; votes: number }[];
  bookId: string;
  yourVote: string | null;
}) {
  const stage: Stage = stageFor(input.status, input.stageOverride);
  const counted = input.voices.filter((voice) => voice.status === "READY" && !voice.hidden);
  // Who spoke, and from where, is sealed until the book is released: before that the public page
  // gets only the number of voices. (The published document is only ever loaded for released books.)
  const reveal = input.status === "PUBLISHED" && Boolean(input.document);
  const ready = reveal ? counted : [];
  const countries = countryStats(ready).map((country) => ({
    code: country.code,
    name: country.name,
    count: country.count,
  }));
  const pins = ready.flatMap((voice) => {
    const country = countryByCode(voice.countryCode);
    if (!country) return [];
    let hash = 0;
    for (const character of voice.contributorName) hash = (hash * 33 + character.charCodeAt(0)) >>> 0;
    return [
      {
        name: voice.contributorName,
        lat: country.lat + ((hash % 21) - 10) * 0.28,
        lng: country.lng + (((hash >> 6) % 21) - 10) * 0.35,
      },
    ];
  });
  const names = ready.map((voice) => ({ name: voice.contributorName, countryCode: voice.countryCode, region: voice.region || "" }));
  const shown = new Set<string>();
  const chapters = (input.document?.chapters ?? []).map((chapter, index) => {
    const quotes = chapter.quotes.filter((quote) => !quote.hidden && quote.englishText.trim());
    // Show a different line under each chapter when the book reuses a quote.
    const first = quotes.find((quote) => !shown.has(quote.englishText.trim())) ?? quotes[0];
    if (first) shown.add(first.englishText.trim());
    return {
      title: chapter.title,
      summary: chapterSummary(chapter.title, chapter.theme, chapter.narrative),
      quote: first ? { text: clip(stripPeopleCounts(first.englishText), 140), name: first.speakerName } : null,
      voices: new Set(quotes.map((quote) => quote.voiceId)).size,
      href: `/b/${input.slug}/read?c=${index + 1}`,
    };
  });
  const words = (input.document?.chapters ?? [])
    .map((chapter) => `${chapter.narrative} ${chapter.quotes.map((quote) => quote.englishText).join(" ")}`)
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
  const clips =
    input.document?.chapters.flatMap((chapter) =>
      chapter.quotes
        .filter((quote) => quote.hasAudio && quote.kind !== "sourced_quote" && !quote.hidden)
        .map((quote) => ({
          src: `/api/audio/${quote.voiceId}`,
          startMs: quote.startMs,
          endMs: quote.endMs,
          name: quote.speakerName,
          text: quote.englishText,
        })),
    ) ?? [];
  return {
    stage,
    question: input.question,
    voiceCount: counted.length,
    sealed: !reveal,
    countries,
    pins,
    names,
    closesAt: input.closesAt?.toISOString() ?? null,
    releaseLabel: releaseLabel(input.publishedAt ?? input.closesAt),
    paused: input.paused,
    voiceHref: stage === "before" && !input.paused ? input.voiceHref : null,
    readHref: `/b/${input.slug}/read`,
    chapters,
    readMins: Math.max(1, Math.ceil(words / 200) || 1),
    listenMins: Math.max(1, Math.round(clips.length * 0.4) || 1),
    pollQuestion: input.pollQuestion,
    poll: input.poll,
    bookId: input.bookId,
    yourVote: input.yourVote,
    clips,
    flag: flagEmoji,
  };
}
