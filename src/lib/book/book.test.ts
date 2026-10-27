import { describe, expect, it } from "vitest";
import { applyEdits, assembleBook, repairModelBook, visibleQuotes } from "./assemble";
import {
  canAcceptVoice,
  canGenerate,
  selectRollback,
  statusAfterGenerationFailure,
  validateSourcedQuote,
} from "./lifecycle";
import { agreementNotes, planChapters, stanceScore } from "./plan";
import { bestQuote, locateSpan, shouldTranslate, spokenStartWord, wavDurationMs } from "./speech";
import type { SourceVoice, Turn } from "./types";
import { estimateTokensUsd, estimateTranscribeUsd, voicesPaused } from "../ai/spend";

const rates = {
  transcribePerHour: 0.18,
  inputPerMtok: 1.25,
  cachedInputPerMtok: 0.15,
  outputPerMtok: 4.25,
};

function voice(overrides: Partial<SourceVoice> & Pick<SourceVoice, "id" | "originalText">): SourceVoice {
  const text = overrides.originalText;
  return {
    contributorName: "Speaker",
    language: "en",
    countryCode: "IN",
    englishText: overrides.englishText ?? text,
    translated: false,
    turns: overrides.turns ?? [{ turnId: 1, startMs: 0, endMs: 8000, transcript: text }],
    durationMs: 8000,
    createdAt: 1,
    kind: "voice",
    sourceUrl: null,
    sourceTitle: null,
    hidden: false,
    status: "READY",
    startWord: "mango",
    hasAudio: true,
    ...overrides,
  };
}

describe("start word", () => {
  it("accepts the word when it is spoken first", () => {
    expect(spokenStartWord("Mango. It makes me lazier on Tuesdays.", "mango")).toBe(true);
    expect(spokenStartWord("  MANGO!! then I kept talking about the draft.", "mango")).toBe(true);
    expect(spokenStartWord("आम यह सच है कि मैं आलसी हो गया", "आम")).toBe(true);
  });

  it("rejects a recording that never says the word up front", () => {
    expect(spokenStartWord("It makes me lazier and then I mention mango at the very end of a long answer here.", "mango")).toBe(false);
    expect(spokenStartWord("", "mango")).toBe(false);
  });
});

describe("translation policy", () => {
  it("skips English and mostly-English Hinglish", () => {
    expect(shouldTranslate("en", "It makes me smarter when I check the draft.")).toBe(false);
    expect(shouldTranslate("hinglish", "AI makes me smarter yaar but I also get lazy when I scroll.")).toBe(false);
    expect(shouldTranslate("es", "AI makes me smarter but I feel lazy sometimes because I skip the draft.")).toBe(false);
  });

  it("translates Hindi and Spanish that are not English", () => {
    expect(shouldTranslate("hi", "यह मुझे आलसी बनाता है जब मैं सोचता नहीं।")).toBe(true);
    expect(shouldTranslate("es", "Me hace más perezoso en el trabajo de cada día.")).toBe(true);
  });
});

describe("quotes and timestamps", () => {
  const turns: Turn[] = [
    { turnId: 1, startMs: 0, endMs: 2000, transcript: "Mango." },
    {
      turnId: 2,
      startMs: 2000,
      endMs: 8000,
      transcript: "It makes me lazier on Tuesdays but smarter when I am stuck.",
    },
  ];

  it("skips the start word and keeps a verbatim sentence", () => {
    const quote = bestQuote("Mango. It makes me lazier on Tuesdays but smarter when I am stuck.", "mango");
    expect(quote).toBe("It makes me lazier on Tuesdays but smarter when I am stuck.");
    const span = locateSpan(turns, `Mango. ${quote}`, quote, 8000);
    expect(span.startMs).toBeGreaterThanOrEqual(2000);
    expect(span.endMs).toBeLessThanOrEqual(8000);
    expect(span.startMs).toBeLessThan(span.endMs);
  });

  it("places a partial quote inside the matching turn", () => {
    const span = locateSpan(turns, turns.map((turn) => turn.transcript).join(" "), "lazier on Tuesdays", 8000);
    expect(span.startMs).toBeGreaterThan(2000);
    expect(span.endMs).toBeLessThanOrEqual(8000);
  });
});

describe("chapters follow the material", () => {
  it("returns no chapters when there is nothing to read", () => {
    expect(planChapters([], "OPEN")).toEqual([]);
  });

  it("keeps one voice as one chapter", () => {
    const chapters = planChapters(
      [voice({ id: "a", originalText: "The draft makes me smarter when I check the answer." })],
      "OPEN",
    );
    expect(chapters).toHaveLength(1);
  });

  it("collapses voices that say the same thing", () => {
    const line = "The draft makes me smarter when I check the answer and lazier when I skip the draft.";
    const chapters = planChapters(
      [
        voice({ id: "a", originalText: line, createdAt: 1 }),
        voice({ id: "b", originalText: `${line} I still check the draft.`, createdAt: 2 }),
        voice({ id: "c", originalText: `${line} The answer needs a check.`, createdAt: 3 }),
      ],
      "OPEN",
    );
    expect(chapters).toHaveLength(1);
  });

  it("splits two subjects instead of forcing a fixed chapter count", () => {
    const draft = "The draft makes me smarter when I check the answer and lazier when I skip the draft.";
    const memory = "My memory gets worse because I forget the lesson I did not write and the memory fades.";
    const chapters = planChapters(
      [
        voice({ id: "a", originalText: draft, createdAt: 1 }),
        voice({ id: "b", originalText: `${draft} I check the answer twice.`, createdAt: 2 }),
        voice({ id: "c", originalText: `${draft} Skipping the draft makes the answer thin.`, createdAt: 3 }),
        voice({ id: "d", originalText: memory, createdAt: 4 }),
        voice({ id: "e", originalText: `${memory} I forget the lesson by morning.`, createdAt: 5 }),
        voice({ id: "f", originalText: `${memory} The memory fades when I do not write.`, createdAt: 6 }),
      ],
      "OPEN",
    );
    expect(chapters).toHaveLength(2);
    expect(chapters.flatMap((chapter) => chapter.voiceIds).sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("does not pin every size to seven chapters", () => {
    const topics = [
      "lighthouse copper velvet mango river",
      "orchestra violin cello trumpet flute",
      "glacier penguin iceberg walrus seals",
      "bakery sourdough croissant brioche yeast",
      "orbit comet asteroid nebula galaxy",
      "karate dojo belt sparring kata",
      "pottery kiln glaze ceramic wheel",
      "saffron cardamom cumin turmeric fennel",
    ];
    const counts = [1, 2, 3, 4, 8].map((size) =>
      planChapters(
        topics.slice(0, size).map((text, index) => voice({ id: `v${index}`, originalText: text, createdAt: index })),
        "OPEN",
      ).length,
    );
    expect(counts).not.toEqual([7, 7, 7, 7, 7]);
    expect(new Set(counts).size).toBeGreaterThan(2);
    expect(counts[4]).toBe(8);
  });

  it("splits a long solo recording into more than one part", () => {
    const line = "Today I walked the same road and wrote down what the day actually felt like.";
    const chapters = planChapters(
      [0, 1, 2, 3].map((index) =>
        voice({ id: `s${index}`, originalText: `${line} Entry ${index} stays on that road.`, createdAt: index }),
      ),
      "SOLO",
    );
    expect(chapters.length).toBeGreaterThan(1);
    expect(chapters.length).toBeLessThan(4);
  });
});

describe("agreement", () => {
  it("hears a split when some voices describe a gain and others a cost", () => {
    const notes = agreementNotes([
      "It makes me smarter and more curious.",
      "It makes me lazier and I forget the work.",
    ]);
    expect(notes.disagreement).toMatch(/gain/);
    expect(notes.agreement).toBeNull();
    expect(stanceScore("This is smarter")).toBeGreaterThan(0);
    expect(stanceScore("This is lazier")).toBeLessThan(0);
  });

  it("hears agreement when the voices share a side", () => {
    const notes = agreementNotes([
      "It makes me smarter every week.",
      "I learn faster and feel sharper.",
    ]);
    expect(notes.agreement).toMatch(/gain/);
    expect(notes.disagreement).toBeNull();
  });
});

describe("assembly and repair", () => {
  it("builds a book whose quotes are verbatim slices with play windows", () => {
    const full = "Mango. It makes me smarter when I check the draft and lazier when I do not.";
    const book = assembleBook({
      title: "Notes",
      question: "Is AI making you smarter or lazier?",
      bookType: "OPEN",
      voices: [
        voice({
          id: "meera",
          contributorName: "Meera",
          originalText: full,
          turns: [
            { turnId: 1, startMs: 0, endMs: 800, transcript: "Mango." },
            { turnId: 2, startMs: 800, endMs: 8000, transcript: full.replace("Mango. ", "") },
          ],
        }),
      ],
      now: "2026-10-26T00:00:00.000Z",
    });
    expect(book.chapters).toHaveLength(1);
    const quote = book.chapters[0].quotes[0];
    expect(full.includes(quote.originalText)).toBe(true);
    expect(quote.originalText.toLowerCase()).not.toBe("mango.");
    expect(quote.startMs).toBeGreaterThanOrEqual(800);
    expect(quote.hasAudio).toBe(true);
  });

  it("repairs a model quote back to the speaker's words and drops invented people", () => {
    const original = "The draft makes me smarter when I check the answer.";
    const book = repairModelBook({
      title: "Notes",
      question: "What changed?",
      bookType: "OPEN",
      provider: "meta",
      modelId: "muse-spark-1.3",
      now: "2026-10-26T00:00:00.000Z",
      voices: [voice({ id: "real", contributorName: "Meera", originalText: original })],
      model: {
        preface: "A short book.",
        chapters: [
          {
            title: "The draft",
            theme: "draft",
            narrative: "Meera talks about the draft.",
            agreement: "",
            disagreement: "",
            quotes: [
              { voiceId: "real", verbatim: "the draft makes me smarter when I check the answer." },
              { voiceId: "invented", verbatim: "I never said this." },
            ],
          },
        ],
      },
    });
    expect(book.provider).toBe("meta");
    expect(book.chapters[0].quotes).toHaveLength(1);
    expect(book.chapters[0].quotes[0].originalText).toBe("The draft makes me smarter when I check the answer.");
    expect(book.chapters[0].quotes[0].voiceId).toBe("real");
  });

  it("keeps a sourced quote attached to its source and without audio", () => {
    const book = assembleBook({
      title: "Public lines",
      question: "What did they say on the record?",
      bookType: "FAMOUS",
      voices: [
        voice({
          id: "q1",
          kind: "sourced_quote",
          hasAudio: false,
          contributorName: "Ada Lovelace",
          originalText: "The Analytical Engine has no pretensions whatever to originate anything.",
          sourceUrl: "https://example.com/source",
          sourceTitle: "Notes",
          startWord: "",
        }),
      ],
    });
    const quote = book.chapters[0].quotes[0];
    expect(quote.hasAudio).toBe(false);
    expect(quote.sourceUrl).toBe("https://example.com/source");
    expect(quote.originalText).toContain("Analytical Engine");
    expect(book.preface.toLowerCase()).toContain("sourced");
  });

  it("edits narrative without rewriting the quotation", () => {
    const book = assembleBook({
      title: "Notes",
      question: "What changed?",
      bookType: "OPEN",
      voices: [voice({ id: "a", originalText: "The draft makes me smarter when I check the answer today." })],
    });
    const quoteId = book.chapters[0].quotes[0].id;
    const edited = applyEdits(book, {
      preface: "Revised preface.",
      chapters: [
        {
          id: book.chapters[0].id,
          title: "A better title",
          narrative: "A calmer bridge between the voices.",
          hiddenQuoteIds: [quoteId],
        },
      ],
    });
    expect(edited.chapters[0].title).toBe("A better title");
    expect(edited.chapters[0].quotes[0].originalText).toBe(book.chapters[0].quotes[0].originalText);
    expect(visibleQuotes(edited)).toHaveLength(0);
  });
});

describe("lifecycle", () => {
  const base = {
    bookType: "OPEN",
    status: "COLLECTING",
    closesAt: Date.parse("2026-11-01T00:00:00Z"),
    creatorId: "owner",
    inviteToken: "invite-token",
    viewerId: null,
    providedInvite: null,
    now: Date.parse("2026-10-26T00:00:00Z"),
    paused: false,
  };

  it("pauses new voices when the cap is reached", () => {
    expect(canAcceptVoice({ ...base, paused: true })).toEqual({
      ok: false,
      reason: "Voices are paused right now",
    });
  });

  it("keeps invited books private and solo books to the author", () => {
    expect(canAcceptVoice({ ...base, bookType: "INVITED", providedInvite: "nope" }).ok).toBe(false);
    expect(canAcceptVoice({ ...base, bookType: "INVITED", providedInvite: "invite-token" }).ok).toBe(true);
    expect(canAcceptVoice({ ...base, bookType: "SOLO", viewerId: "other" }).ok).toBe(false);
    expect(canAcceptVoice({ ...base, bookType: "SOLO", viewerId: "owner" }).ok).toBe(true);
  });

  it("refuses recordings on a famous-voice book", () => {
    expect(canAcceptVoice({ ...base, bookType: "FAMOUS" }).ok).toBe(false);
  });

  it("requires an open book to close before it is written", () => {
    expect(canGenerate({ bookType: "OPEN", status: "COLLECTING", readyCount: 2, paused: false, live: false }).ok).toBe(false);
    expect(canGenerate({ bookType: "OPEN", status: "CLOSED", readyCount: 2, paused: false, live: false }).ok).toBe(true);
    expect(canGenerate({ bookType: "SOLO", status: "COLLECTING", readyCount: 1, paused: false, live: false }).ok).toBe(true);
    expect(canGenerate({ bookType: "OPEN", status: "CLOSED", readyCount: 2, paused: true, live: true }).ok).toBe(false);
  });

  it("rolls back the pointer and keeps every version", () => {
    const versions = [
      { id: "d1", version: 1 },
      { id: "d2", version: 2 },
    ];
    const next = selectRollback(versions, "d1", "d2");
    expect(next).toEqual({ nextCurrentId: "d1", versions });
    expect(statusAfterGenerationFailure("PUBLISHED")).toBe("PUBLISHED");
    expect(statusAfterGenerationFailure("CLOSED")).toBe("CLOSED");
  });

  it("requires a real source link for a famous quotation", () => {
    expect(validateSourcedQuote({ speaker: "Ada", text: "Too short", sourceUrl: "https://example.com" }).ok).toBe(false);
    expect(
      validateSourcedQuote({
        speaker: "Ada Lovelace",
        text: "The Analytical Engine weaves algebraical patterns.",
        sourceUrl: "https://example.com/notes",
      }).ok,
    ).toBe(true);
    expect(
      validateSourcedQuote({
        speaker: "Ada Lovelace",
        text: "The Analytical Engine weaves algebraical patterns.",
        sourceUrl: "javascript:alert(1)",
      }).ok,
    ).toBe(false);
  });
});

describe("spend guard", () => {
  it("uses the published Meta rates", () => {
    expect(estimateTranscribeUsd(30_400, rates)).toBeCloseTo((30 / 3600) * 0.18);
    expect(estimateTranscribeUsd(400, rates)).toBe(0);
    expect(
      estimateTokensUsd({ inputTokens: 1_000_000, cachedTokens: 200_000, outputTokens: 500_000 }, rates),
    ).toBeCloseTo(0.8 * 1.25 + 0.2 * 0.15 + 0.5 * 4.25);
  });

  it("pauses only after the cap", () => {
    expect(voicesPaused(3.2, 3)).toBe(true);
    expect(voicesPaused(2.9, 3)).toBe(false);
    expect(voicesPaused(100, null)).toBe(false);
    expect(voicesPaused(0, 0)).toBe(true);
  });
});

describe("wav duration", () => {
  it("reads a minimal PCM header", () => {
    const dataBytes = 16000 * 2;
    const buffer = Buffer.alloc(44 + 8);
    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + dataBytes, 4);
    buffer.write("WAVE", 8);
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(16000, 24);
    buffer.writeUInt32LE(32000, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write("data", 36);
    buffer.writeUInt32LE(dataBytes, 40);
    expect(wavDurationMs(buffer)).toBe(1000);
  });
});
