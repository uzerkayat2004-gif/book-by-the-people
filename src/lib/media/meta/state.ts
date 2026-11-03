import "server-only";
import { getAudio, putAudio } from "@/lib/storage";
import { EMPTY_PICKS, type MediaPicks } from "./catalog";
import type { ChapterScript } from "./text";

/** One stored piece of a chapter's narration. */
export type PartFile = { key: string; ms: number };

export type UnitState = {
  lang: string;
  unit: number;
  title: string;
  /** Hash of everything the script depends on. */
  scriptHash: string;
  scriptKey?: string;
  /** True when the plain script was used (no model, or the model kept failing). */
  plain?: boolean;
  note?: string;
  voiceHash: string;
  parts?: PartFile[];
  /** How many parts the narration is cut into (known once the script exists). */
  partCount?: number;
  tries: number;
};

export type AudioResult = {
  key: string;
  bytes: number;
  ms: number;
  chapters: { title: string; startMs: number }[];
  writer: string;
  voice: string;
  plainUnits: number;
  madeAt: string;
  hash: string;
};

export type Run = {
  id: string;
  status: "running" | "ready" | "failed";
  draftId: string;
  languages: string[];
  skipped: { lang: string; reason: string }[];
  writer: { value: string; label: string };
  voices: Record<string, string>;
  units: UnitState[];
  startedAt: string;
  finishedAt?: string;
  error?: string;
  phase: string;
};

export type MediaState = {
  v: 1;
  picks: MediaPicks;
  run?: Run;
  audio: Record<string, AudioResult>;
  /** Runs started per day, to keep a book inside its daily cap. */
  starts?: { day: string; count: number };
};

export const stateKey = (bookId: string) => `book-${bookId}-mm-state.json`;

export async function readState(bookId: string): Promise<MediaState> {
  try {
    const raw = JSON.parse((await getAudio(stateKey(bookId))).toString("utf8")) as MediaState;
    if (raw && raw.v === 1) return { ...raw, picks: { audiobook: { ...EMPTY_PICKS.audiobook, ...(raw.picks?.audiobook ?? {}) } }, audio: raw.audio ?? {} };
  } catch {
    // none yet
  }
  return { v: 1, picks: structuredClone(EMPTY_PICKS), audio: {} };
}

export async function writeState(bookId: string, state: MediaState): Promise<void> {
  await putAudio(stateKey(bookId), Buffer.from(JSON.stringify(state)), "application/json");
}

export async function readScript(key: string): Promise<ChapterScript> {
  return JSON.parse((await getAudio(key)).toString("utf8")) as ChapterScript;
}
