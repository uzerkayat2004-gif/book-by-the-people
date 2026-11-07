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
  /** Extra query for read links (e.g. "lang=ja" for a translated edition). */
  readQuery?: string;
  paused: boolean;
  voiceHref: string | null;
  document: BookDocument | null;
  pollQuestion: string;
  poll: { id: string; label: string; votes: number }[];
  bookId: string;
  yourVote: string | null;
  /** Open, listed books light a dot on the globe for each voice while voices are still coming in (no names). */
  liveGlobe?: boolean;
  /** Finished audiobook size; used for the listen time when there are no quote clips. */
  audioBytes?: number | null;
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
  // Released: every voice with its name. Still collecting (open, listed books): an unnamed dot per voice,
  // so a new voice shows on the globe right away while names and words stay sealed.
  const dots = reveal ? ready : input.liveGlobe ? counted : [];
  // Open, listed books show who has spoken (name and place only) while the words stay sealed.
  const named = reveal || Boolean(input.liveGlobe);
  const pins = dots.flatMap((voice) => {
    const country = countryByCode(voice.countryCode);
    if (!country) return [];
    let hash = 0;
    for (const character of reveal ? voice.contributorName : voice.id) hash = (hash * 33 + character.charCodeAt(0)) >>> 0;
    return [
      {
        name: named ? publicName(voice.contributorName) : "",
        place: named ? placeLabel(voice.region, country.name) : "",
        lat: country.lat + ((hash % 21) - 10) * 0.28,
        lng: country.lng + (((hash >> 6) % 21) - 10) * 0.35,
      },
    ];
  });
  // Everyone who spoke, for the list under the voice count: name and place, never words or emails.
  const people = (named ? dots : []).map((voice) => ({
    name: publicName(voice.contributorName),
    countryCode: voice.countryCode,
    place: placeLabel(voice.region, countryByCode(voice.countryCode)?.name ?? ""),
  }));
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
      voices: chapter.voices ?? new Set(quotes.map((quote) => quote.voiceId)).size,
      href: `/b/${input.slug}/read?c=${index + 1}${input.readQuery ? `&${input.readQuery}` : ""}`,
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
    people,
    names,
    closesAt: input.closesAt?.toISOString() ?? null,
    releaseLabel: releaseLabel(input.publishedAt ?? input.closesAt),
    paused: input.paused,
    voiceHref: stage === "before" && !input.paused ? input.voiceHref : null,
    readHref: `/b/${input.slug}/read${input.readQuery ? `?${input.readQuery}` : ""}`,
    chapters,
    readMins: Math.max(1, Math.ceil(words / 200) || 1),
    listenMins: listenMinutes(clips.length, input.audioBytes),
    pollQuestion: input.pollQuestion,
    poll: input.poll,
    bookId: input.bookId,
    yourVote: input.yourVote,
    clips,
    flag: flagEmoji,
  };
}

/** Listen time from the finished file (64 kbps Meta mix) when we have it, otherwise from quote clips. */
export function listenMinutes(clipCount: number, audioBytes?: number | null): number {
  if (audioBytes && audioBytes > 1000) return Math.max(1, Math.round((audioBytes * 8) / 64_000 / 60));
  return Math.max(1, Math.round(clipCount * 0.4) || 1);
}

/** A contributor's public name: what they typed in About you, never an email address. */
export function publicName(name: string): string {
  const clean = name.replace(/\s+/g, " ").trim();
  const masked = clean.includes("@") ? clean.split("@")[0].replace(/[._-]+/g, " ").trim() : clean;
  return masked.slice(0, 60) || "Someone";
}

/** "Pune, India" when a region was given, else just the country. */
export function placeLabel(region: string | undefined, country: string): string {
  const area = (region ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!country) return area;
  return area && area.toLowerCase() !== country.toLowerCase() ? `${area}, ${country}` : country;
}
