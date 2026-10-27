import type { SourceVoice } from "../book/types";

export const BOOK_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    preface: { type: "string" },
    chapters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          theme: { type: "string" },
          narrative: { type: "string" },
          agreement: { type: "string" },
          disagreement: { type: "string" },
          quotes: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                voiceId: { type: "string" },
                verbatim: { type: "string" },
              },
              required: ["voiceId", "verbatim"],
            },
          },
        },
        required: ["title", "theme", "narrative", "agreement", "disagreement", "quotes"],
      },
    },
  },
  required: ["preface", "chapters"],
} as const;

export const TRANSLATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    translations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          english: { type: "string" },
        },
        required: ["id", "english"],
      },
    },
  },
  required: ["translations"],
} as const;

export function bookMessages(input: {
  title: string;
  question: string;
  bookType: string;
  voices: SourceVoice[];
}): { system: string; user: string } {
  const ceiling = Math.min(8, Math.max(1, input.voices.length));
  const system = [
    "You are the editor of a book made from real people's voices.",
    "Write the connecting narrative. Do not invent speakers, events, or quotations.",
    "Every verbatim field must be an exact substring of that voice's originalText, not the translation.",
    "Do not quote the anti-spam start word by itself.",
    "Pick one strong sentence per voice. Keep the speaker's words, including if they are not in English.",
    `Choose the number of chapters from the variety of what was said. Do not default to 7 or to any fixed count. Use fewer chapters when people are talking about the same thing, and more when they are not. Stay between 1 and ${ceiling}.`,
    "In each chapter, say where the voices agree and where they disagree. Leave the field empty when you do not hear it.",
    "The narrative may connect themes. It must not put new claims in a speaker's mouth.",
    input.bookType === "FAMOUS"
      ? "This is a famous-voices book made only of public sourced quotations. Do not imply anyone recorded audio for this book. Do not invent biography. Do not drop a quotation. Never suggest synthesizing a voice."
      : "The play button will use each quotation's timestamps, so choose a sentence that actually appears in originalText.",
  ].join(" ");

  const voices = input.voices.map((voice) => ({
    voiceId: voice.id,
    name: voice.contributorName,
    language: voice.language,
    country: voice.countryCode,
    kind: voice.kind,
    sourceUrl: voice.sourceUrl,
    startWord: voice.startWord,
    originalText: voice.originalText,
    englishText: voice.englishText,
    turns: voice.turns.map((turn) => ({
      startMs: turn.startMs,
      endMs: turn.endMs,
      transcript: turn.transcript,
    })),
  }));

  const user = JSON.stringify(
    {
      title: input.title,
      question: input.question,
      bookType: input.bookType,
      voices,
    },
    null,
    2,
  );
  return { system, user };
}

export function translationMessages(items: { id: string; language: string; text: string }[]): { system: string; user: string } {
  return {
    system:
      "Translate each speech transcript into natural English. Preserve names, hesitation, and meaning. Do not add ideas, smooth away disagreement, or invent context. If a line is already English, return it unchanged.",
    user: JSON.stringify({ transcripts: items }),
  };
}
