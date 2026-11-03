import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { BookDocument } from "@/lib/book/types";
import { chatJson } from "@/lib/ai/provider-client";
import { extractJson } from "@/lib/ai";
import { bookLanguage } from "@/lib/languages";
import { deleteAudio, getAudio, putAudio } from "@/lib/storage";
import { bookSpendPaused, recordUsage } from "@/lib/services/spend";
import { isMetaMediaKey, isUploadedKey } from "../render";
import { voiceOptions } from "./catalog";
import { FLAG_CODES } from "./flag-codes";
import { phrasesFor } from "./phrases";
import { mediaMetaOnly } from "./flag";
import { isFeatureBook, narrationUnits, unitSource } from "./narrate";
import { readScript, readState, type AudioResult, type MediaState, type TimedCue } from "./state";
import {
  PICTURE_STYLE,
  ART_SCHEMA,
  CHECK_SCHEMA,
  PICTURE_AVOID,
  PLAIN_ART,
  artLine,
  artPrompt,
  checkPrompt,
  needsRedraw,
  parseArt,
  type ArtDirection,
  STORYBOARD_SCHEMA,
  parseStoryboard,
  captionChunks,
  plainStoryboard,
  paceScenes,
  withPicture,
  featureBoardPrompt,
  featureOverlays,
  parseFeatureBoard,
  picturesFor,
  plainFeatureBoard,
  type Overlay,
  storyboardPrompt,
  unitQuotes,
  type QuoteRef,
  type Storyboard,
} from "./storyboard";
import { imageOptions, imageTarget, makePicture, safeError, writerOptions, writerTarget } from "./targets";
import {
  advanceAudiobook,
  documentsFor,
  dropLease,
  hash,
  progressOf as audioProgressOf,
  retryable,
  runHash,
  savePicks as saveAudioPicks,
  startAudiobook,
  takeLease,
  today,
} from "./audiobook";

/** Bump when the storyboard prompt, picture style or the film's look changes. */
const SB_V = 4;
const IMG_V = 2;
const FILM_V = 4;
const CARD_MS = 8000;
export const VIDEO_RUNS_PER_DAY = 3;
export const MAX_PICTURES = 24;
const PICTURE_USD = 0.01;
export const CHUNK_BYTES = 3 * 1024 * 1024;
const MAX_FILM_BYTES = 400 * 1024 * 1024;
const END_MS = 4000;
const leaseKey = (bookId: string) => `${bookId}:mm:video`;

type UnitBoard = { unit: number; title: string; hash: string; scriptKey: string; key?: string; plain?: boolean; note?: string };
type Picture = { id: string; prompt: string; key?: string; failed?: boolean; note?: string; tries: number; score?: number; redrawn?: boolean };

export type VideoRun = {
  id: string;
  status: "running" | "assemble" | "ready" | "failed";
  phase: string;
  lang: string;
  waitingForAudio: boolean;
  audio?: { key: string; hash: string; ms: number; cuesKey?: string; units: NonNullable<AudioResult["units"]>; voice: string; writer: string };
  writer: { value: string; label: string };
  image: { value: string; label: string };
  units: UnitBoard[];
  pictures: Picture[];
  /** One look for every picture (feature books). */
  art?: ArtDirection;
  artPlain?: boolean;
  planHash?: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
};

export type VideoResult = {
  key: string;
  bytes: number;
  ms: number;
  hash: string;
  madeAt: string;
  writer: string;
  image: string;
  voice: string;
  pictures: number;
  quotes: number;
  codec: string;
};

export type VideoState = {
  v: 1;
  picks: { writer: string; images: string };
  run?: VideoRun;
  video?: VideoResult;
  /** Work kept across runs, so a changed pick only redoes what it touches. */
  cache: { boards: Record<string, { key: string; plain?: boolean; note?: string }>; pictures: Record<string, string>; art?: Record<string, ArtDirection> };
  starts?: { day: string; count: number };
};

const videoKey = (bookId: string) => `book-${bookId}-mm-video-state.json`;

export async function readVideo(bookId: string): Promise<VideoState> {
  try {
    const raw = JSON.parse((await getAudio(videoKey(bookId))).toString("utf8")) as VideoState;
    if (raw && raw.v === 1) {
      return { ...raw, picks: { writer: raw.picks?.writer ?? "", images: raw.picks?.images ?? "" }, cache: { boards: raw.cache?.boards ?? {}, pictures: raw.cache?.pictures ?? {}, art: raw.cache?.art ?? {} } };
    }
  } catch {
    // none yet
  }
  return { v: 1, picks: { writer: "", images: "" }, cache: { boards: {}, pictures: {} } };
}

async function writeVideo(bookId: string, state: VideoState) {
  await putAudio(videoKey(bookId), Buffer.from(JSON.stringify(state)), "application/json");
}

/** Is the main-language narration finished and current? */
function narrationReady(audioState: MediaState, lang: string): AudioResult | null {
  const audio = audioState.audio[lang];
  if (!audio) return null;
  if (audioState.run?.status === "running" && audioState.run.languages.includes(lang) && audio.hash !== runHash(audioState.run, lang)) return null;
  return audio;
}

async function pickedWriter(bookId: string, pick: string) {
  const options = await writerOptions(bookId);
  const chosen = options.find((o) => o.value === pick && o.usable) ?? options.find((o) => o.recommended);
  return chosen ? { value: chosen.value, label: `${chosen.model} · ${chosen.provider}` } : { value: "", label: "Built-in storyboard (no AI model)" };
}

async function pickedImages(bookId: string, pick: string) {
  const options = await imageOptions(bookId);
  const chosen = options.find((o) => o.value === pick && o.usable) ?? options.find((o) => o.recommended);
  return chosen && chosen.value !== "none" ? { value: chosen.value, label: `${chosen.model} · ${chosen.provider}` } : { value: "none", label: "No pictures (styled cards)" };
}

/** Starts the video book with the saved picks. The narration is the audiobook's (made first if it is missing or out of date). */
export async function startVideo(bookId: string): Promise<VideoState> {
  if (await bookSpendPaused(bookId)) throw new AppError("This book reached its usage limit. Raise it in Book settings to make the video book.");
  const { mainLang } = await documentsFor(bookId);
  const state = await readVideo(bookId);
  if (state.run?.status === "running") return state;
  const starts = state.starts?.day === today() ? state.starts : { day: today(), count: 0 };
  if (starts.count >= VIDEO_RUNS_PER_DAY) throw new AppError(`You can make the video book ${VIDEO_RUNS_PER_DAY} times a day. Try again tomorrow.`);
  if (!voiceOptions(mainLang, mediaMetaOnly()).length) {
    throw new AppError(`There is no Meta voice for ${bookLanguage(mainLang).name} yet, so the video book can't be narrated.`);
  }
  // The narration: reuse the audiobook when nothing it depends on changed; otherwise only the changed steps run.
  let audioState: MediaState;
  try {
    audioState = await startAudiobook(bookId);
  } catch (error) {
    audioState = await readState(bookId);
    if (!audioState.audio[mainLang]) throw error;
  }
  const run: VideoRun = {
    id: randomUUID(),
    status: "running",
    phase: "Getting ready",
    lang: mainLang,
    waitingForAudio: !narrationReady(audioState, mainLang),
    writer: await pickedWriter(bookId, state.picks.writer),
    image: await pickedImages(bookId, state.picks.images),
    units: [],
    pictures: [],
    startedAt: new Date().toISOString(),
  };
  state.run = run;
  state.starts = { day: starts.day, count: starts.count + 1 };
  await writeVideo(bookId, state);
  return state;
}

function setupUnits(run: VideoRun, audio: AudioResult, doc: BookDocument) {
  if (!audio.units?.length) throw new AppError("The audiobook was made by an older version. Make the audiobook again, then the video book.");
  run.audio = { key: audio.key, hash: audio.hash, ms: audio.ms, cuesKey: audio.cuesKey, units: audio.units, voice: audio.voice, writer: audio.writer };
  const pictures = run.image.value !== "none";
  run.units = audio.units.map((u) => ({
    unit: u.unit,
    title: unitSource(doc, u.unit).title,
    scriptKey: u.scriptKey,
    hash: hash(u.scriptKey, run.writer.value, pictures ? 1 : 0, SB_V, isFeatureBook(doc) ? picturesFor(u.ms, u.unit) : 0),
  }));
}

async function makeBoard(bookId: string, run: VideoRun, unit: UnitBoard, doc: BookDocument, state: VideoState, deadline: number): Promise<void> {
  // A new art direction means new picture prompts.
  const boardId = run.art ? hash(unit.hash, artLine(run.art)) : unit.hash;
  const cached = state.cache.boards[boardId];
  if (cached) {
    Object.assign(unit, cached);
    return;
  }
  const script = await readScript(unit.scriptKey);
  const quotes = unitQuotes(doc, unit.unit);
  const pictures = run.image.value !== "none";
  let board: Storyboard | null = null;
  let note: string | undefined;
  const target = run.writer.value ? await writerTarget(bookId, run.writer.value).catch(() => null) : null;
  const feature = isFeatureBook(doc);
  const ms = run.audio?.units.find((u) => u.unit === unit.unit)?.ms ?? 60_000;
  const count = picturesFor(ms, unit.unit);
  if (feature && pictures && target) {
    const prompt = featureBoardPrompt({ unit: unit.unit, bookTitle: doc.title, question: doc.question, sectionTitle: unit.title, arc: doc.outline?.arc ?? "", script, count, art: run.art });
    for (let attempt = 0; attempt < 3 && !board; attempt += 1) {
      const room = deadline - Date.now();
      if (room < 25_000) return;
      try {
        const out = await chatJson(target, { ...prompt, schemaName: "storyboard", schema: STORYBOARD_SCHEMA, maxTokens: 5000, reasoningEffort: "low", timeoutMs: Math.min(90_000, room - 10_000) });
        await recordUsage({ kind: "media-storyboard", provider: target.tag, model: out.model, bookId, usage: out.usage }).catch(() => undefined);
        board = parseFeatureBoard(extractJson(out.content), script.segments.length, count);
      } catch (error) {
        note = safeError(error, target.apiKey);
        if (!retryable(error) && !(error instanceof Error && /storyboard came back/.test(error.message))) break;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, [2000, 6000][attempt]));
      }
    }
  } else if (feature) {
    // nothing to ask: pictures are off, or there is no model (the plain board below).
  } else if (target) {
    const prompt = storyboardPrompt({ unit: unit.unit, total: narrationUnits(doc), bookTitle: doc.title, question: doc.question, script, quotes, pictures });
    for (let attempt = 0; attempt < 3 && !board; attempt += 1) {
      const room = deadline - Date.now();
      if (room < 25_000) return;
      try {
        const out = await chatJson(target, { ...prompt, schemaName: "storyboard", schema: STORYBOARD_SCHEMA, maxTokens: 6000, reasoningEffort: "low", timeoutMs: Math.min(90_000, room - 10_000) });
        await recordUsage({ kind: "media-storyboard", provider: target.tag, model: out.model, bookId, usage: out.usage }).catch(() => undefined);
        board = parseStoryboard(extractJson(out.content), script.segments.length, quotes.length, pictures);
      } catch (error) {
        note = safeError(error, target.apiKey);
        if (!retryable(error) && !(error instanceof Error && /storyboard came back/.test(error.message))) break;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, [2000, 6000][attempt]));
      }
    }
  }
  const plain = !board;
  const chapter = unit.unit > 0 ? doc.chapters[unit.unit - 1] : null;
  if (!board && feature) {
    const about = unit.unit === 0 ? `An evocative scene about the question: ${doc.question}` : `An evocative scene about "${unit.title}"`;
    board = pictures ? plainFeatureBoard(script.segments.length, count, about) : { scenes: [{ kind: "card", segment: 0 }] };
  }
  if (!board) board = plainStoryboard({ unit: unit.unit, script, quotes, pictures, title: unit.title, theme: chapter?.theme, question: doc.question });
  // Every chapter gets at least one picture when pictures are on.
  if (pictures && !feature) {
    const fallback = unit.unit === 0 ? `An evocative scene about the question: ${doc.question}` : `An evocative scene about "${unit.title}"${chapter?.theme ? `: ${chapter.theme}` : ""}`;
    board = withPicture(board, script.segments.length, fallback);
  }
  const key = `book-${bookId}-mm-sb-u${unit.unit}-${boardId}.json`;
  await putAudio(key, Buffer.from(JSON.stringify(board)), "application/json");
  unit.key = key;
  unit.plain = plain;
  unit.note = plain && target ? `Built-in storyboard used: ${note ?? "the model did not answer"}` : undefined;
  state.cache.boards[boardId] = { key, plain: unit.plain, note: unit.note };
}

async function readBoard(key: string): Promise<Storyboard> {
  return JSON.parse((await getAudio(key)).toString("utf8")) as Storyboard;
}

const pictureId = (prompt: string, model: string) => hash(prompt, model, IMG_V);
const fullPrompt = (prompt: string, art?: ArtDirection) =>
  art ? `${prompt.replace(/[.\s]+$/, "")}. ${artLine(art)} ${PICTURE_AVOID}` : `${prompt.replace(/[.\s]+$/, "")}. ${PICTURE_STYLE}`;

/** One art direction per book, from its outline. Kept, so a re-make draws in the same look. */
async function makeArt(bookId: string, run: VideoRun, doc: BookDocument, state: VideoState): Promise<void> {
  const id = hash(doc.title, doc.question, doc.outline?.arc ?? "", run.writer.value);
  const kept = state.cache.art?.[id];
  if (kept) {
    run.art = kept;
    return;
  }
  const target = run.writer.value ? await writerTarget(bookId, run.writer.value).catch(() => null) : null;
  if (target) {
    try {
      const out = await chatJson(target, { ...artPrompt(doc), schemaName: "art_direction", schema: ART_SCHEMA, maxTokens: 2000, reasoningEffort: "low", timeoutMs: 60_000 });
      await recordUsage({ kind: "media-storyboard", provider: target.tag, model: out.model, bookId, usage: out.usage }).catch(() => undefined);
      run.art = parseArt(extractJson(out.content));
      state.cache.art = { ...(state.cache.art ?? {}), [id]: run.art };
      return;
    } catch {
      // the house look below
    }
  }
  run.art = PLAIN_ART;
  run.artPlain = true;
}

/** Muse Spark looks at a new picture; a clear fault (text, a bad hand, off-brief) gets one redraw. */
async function checkPicture(bookId: string, run: VideoRun, picture: Picture, made: { bytes: Buffer; mime: string }, timeLeft: number) {
  if (!run.writer.value || timeLeft < 30_000) return null;
  const target = await writerTarget(bookId, run.writer.value).catch(() => null);
  if (!target) return null;
  try {
    const brief = picture.prompt.split(" Style: ")[0];
    const out = await chatJson(target, {
      ...checkPrompt(brief),
      schemaName: "picture_check",
      schema: CHECK_SCHEMA,
      maxTokens: 1500,
      reasoningEffort: "low",
      timeoutMs: Math.min(45_000, timeLeft - 10_000),
      images: [`data:${made.mime};base64,${made.bytes.toString("base64")}`],
    });
    await recordUsage({ kind: "media-storyboard", provider: target.tag, model: out.model, bookId, usage: out.usage }).catch(() => undefined);
    return needsRedraw(extractJson(out.content));
  } catch {
    return null;
  }
}

async function listPictures(run: VideoRun, state: VideoState) {
  if (run.image.value === "none") {
    run.pictures = [];
    return;
  }
  const seen = new Set<string>();
  const pictures: Picture[] = [];
  for (const unit of run.units) {
    const board = await readBoard(unit.key!);
    for (const scene of board.scenes) {
      if (scene.kind !== "picture" || !scene.prompt) continue;
      const prompt = fullPrompt(scene.prompt, run.art);
      const id = pictureId(prompt, run.image.value);
      if (seen.has(id) || pictures.length >= MAX_PICTURES) continue;
      seen.add(id);
      const old = run.pictures.find((p) => p.id === id);
      pictures.push({ id, prompt, key: state.cache.pictures[id], failed: old?.failed, note: old?.note, tries: old?.tries ?? 0 });
    }
  }
  run.pictures = pictures;
}

function planHashOf(run: VideoRun) {
  return hash(run.audio?.hash ?? "", ...run.units.map((u) => u.hash), ...run.pictures.map((p) => p.key ?? "card"), FILM_V);
}

export type VideoProgress = {
  status: "none" | "running" | "busy" | "assemble" | "ready" | "failed";
  phase: string;
  percent: number;
  narration: { ready: boolean; percent: number };
  boards: { done: number; total: number; plain: number };
  pictures: { done: number; total: number; failed: number };
  error?: string;
};

export function videoProgressOf(state: VideoState, audioState: MediaState | null, busy = false): VideoProgress {
  const run = state.run;
  const empty = { narration: { ready: false, percent: 0 }, boards: { done: 0, total: 0, plain: 0 }, pictures: { done: 0, total: 0, failed: 0 } };
  if (!run) return { status: "none", phase: "", percent: 0, ...empty };
  const narration = run.waitingForAudio ? (audioState ? audioProgressOf(audioState).percent : 0) : 100;
  const boardsDone = run.units.filter((u) => u.key).length;
  const picturesDone = run.pictures.filter((p) => p.key || p.failed).length;
  const percent =
    run.status === "ready"
      ? 100
      : run.status === "assemble"
        ? 80
        : Math.min(
            79,
            Math.round(narration * 0.4 + (run.units.length ? (boardsDone / run.units.length) * 10 : 0) + (run.pictures.length ? (picturesDone / run.pictures.length) * 30 : run.units.length && boardsDone === run.units.length ? 30 : 0)),
          );
  return {
    status: busy && run.status === "running" ? "busy" : run.status,
    phase: run.phase,
    percent,
    narration: { ready: !run.waitingForAudio, percent: narration },
    boards: { done: boardsDone, total: run.units.length, plain: run.units.filter((u) => u.plain).length },
    pictures: { done: run.pictures.filter((p) => p.key).length, total: run.pictures.length, failed: run.pictures.filter((p) => p.failed).length },
    error: run.error,
  };
}

/** Does the next bit of work for about `budgetMs`. Studio calls this until the film is ready to put together. */
export async function advanceVideo(bookId: string, budgetMs = 150_000): Promise<VideoProgress> {
  const started = Date.now();
  let state = await readVideo(bookId);
  if (state.run?.status !== "running") return videoProgressOf(state, null);
  if (!(await takeLease(bookId, leaseKey(bookId), "video"))) return videoProgressOf(state, null, true);
  state = await readVideo(bookId);
  const run = state.run;
  if (!run || run.status !== "running") {
    await dropLease(bookId, null, leaseKey(bookId));
    return videoProgressOf(state, null);
  }
  const left = () => budgetMs - (Date.now() - started);
  let audioState: MediaState | null = null;
  try {
    const { docs } = await documentsFor(bookId);
    const doc = docs.get(run.lang);
    if (!doc) throw new AppError("The book changed while the video book was being made. Press Make again.");

    // 1. The narration (the audiobook in the book's language).
    if (run.waitingForAudio) {
      run.phase = "Recording the narration with the Meta voice";
      audioState = await readState(bookId);
      let audio = narrationReady(audioState, run.lang);
      if (!audio && audioState.run?.status === "running") {
        await advanceAudiobook(bookId, Math.max(30_000, left() - 15_000));
        audioState = await readState(bookId);
        audio = narrationReady(audioState, run.lang);
      }
      if (!audio && audioState.run?.status !== "running") {
        throw new AppError(audioState.run?.error ? `The narration stopped: ${audioState.run.error}` : "The narration is missing. Make the audiobook first.");
      }
      if (audio) {
        run.waitingForAudio = false;
        setupUnits(run, audio, doc);
      }
      await writeVideo(bookId, state);
    } else if (!run.audio) {
      audioState = await readState(bookId);
      const audio = audioState.audio[run.lang];
      if (!audio) throw new AppError("The narration is missing. Make the audiobook first.");
      setupUnits(run, audio, doc);
    }

    if (!run.waitingForAudio) {
      // 2. One art direction for the whole film, then storyboards, four at a time.
      if (isFeatureBook(doc) && run.image.value !== "none" && !run.art) {
        run.phase = "Choosing the film's look";
        await makeArt(bookId, run, doc, state);
        await writeVideo(bookId, state);
      }
      const needBoard = run.units.filter((u) => !u.key);
      if (needBoard.length) run.phase = run.writer.value ? `Planning the scenes with ${run.writer.label.split(" · ")[0]}` : "Planning the scenes";
      for (let i = 0; i < needBoard.length && left() > 60_000; i += 4) {
        await Promise.all(needBoard.slice(i, i + 4).map((unit) => makeBoard(bookId, run, unit, doc, state, started + budgetMs)));
        await writeVideo(bookId, state);
      }

      // 3. Pictures, three at a time, while the spend guard allows.
      if (run.units.every((u) => u.key)) {
        await listPictures(run, state);
        const target = run.image.value !== "none" ? await imageTarget(bookId, run.image.value).catch(() => null) : null;
        let todo = run.pictures.filter((p) => !p.key && !p.failed);
        if (todo.length && !target) {
          for (const picture of todo) Object.assign(picture, { failed: true, note: "The picture model is not available: a styled card is used." });
          todo = [];
        }
        while (todo.length && left() > 70_000) {
          if (await bookSpendPaused(bookId)) {
            for (const picture of todo) Object.assign(picture, { failed: true, note: "Usage limit reached: a styled card is used." });
            break;
          }
          run.phase = `Drawing the scenes with ${run.image.label.split(" · ")[0]} (${run.pictures.filter((p) => p.key).length + 1} of ${run.pictures.length})`;
          await writeVideo(bookId, state);
          await Promise.all(
            todo.slice(0, 3).map(async (picture) => {
              try {
                let made = await makePicture(target!, picture.prompt, Math.min(100_000, left() - 15_000));
                await recordUsage({ kind: "media-image", provider: "meta", model: target!.model, bookId, usd: PICTURE_USD }).catch(() => undefined);
                const check = await checkPicture(bookId, run, picture, made, left() - 40_000);
                if (check) picture.score = check.score;
                if (check?.redo && !picture.redrawn && left() > 60_000 && !(await bookSpendPaused(bookId))) {
                  picture.redrawn = true;
                  const fix = check.fix || `Fix: ${check.problems.join(", ")}.`;
                  try {
                    made = await makePicture(target!, `${picture.prompt} Correction: ${fix}`.slice(0, 3800), Math.min(100_000, left() - 15_000));
                    await recordUsage({ kind: "media-image", provider: "meta", model: target!.model, bookId, usd: PICTURE_USD }).catch(() => undefined);
                  } catch {
                    // keep the first picture
                  }
                }
                const ext = made.mime === "image/png" ? "png" : made.mime === "image/webp" ? "webp" : "jpg";
                const key = `book-${bookId}-mm-pic-${picture.id}.${ext}`;
                await putAudio(key, made.bytes, made.mime);
                picture.key = key;
                state.cache.pictures[picture.id] = key;
              } catch (error) {
                picture.tries += 1;
                picture.note = safeError(error, target!.apiKey);
                if (!retryable(error) || picture.tries >= 3) picture.failed = true;
              }
            }),
          );
          await writeVideo(bookId, state);
          todo = run.pictures.filter((p) => !p.key && !p.failed);
        }

        // 4. Everything is ready for the browser to put the film together.
        if (!todo.length) {
          run.planHash = planHashOf(run);
          if (state.video?.hash === run.planHash) {
            run.status = "ready";
            run.phase = "Ready";
            run.finishedAt = new Date().toISOString();
          } else {
            run.status = "assemble";
            run.phase = "Putting the film together in your browser";
          }
          await writeVideo(bookId, state);
        }
      }
    }
    await dropLease(bookId, null, leaseKey(bookId));
  } catch (error) {
    run.status = "failed";
    run.error = safeError(error);
    run.phase = "Stopped";
    await writeVideo(bookId, state).catch(() => undefined);
    await dropLease(bookId, run.error, leaseKey(bookId));
  }
  return videoProgressOf(state, audioState);
}

/* ---------- The film plan the browser renders ---------- */

export type PlanScene = {
  startMs: number;
  endMs: number;
  kind: "opening" | "picture" | "quote" | "card" | "end";
  image?: string;
  title?: string;
  subtitle?: string;
  quote?: QuoteRef;
  /** Shown over the first seconds of a chapter. */
  chapter?: string;
  /** Which part of the book (0 is the opening). */
  unit?: number;
  /** End credits, one line each. */
  credits?: string[];
};

/** The branded opening: every country's flag behind the title, the logo, and exactly how many took part. */
export type FilmOpening = { flags: string[]; people: number; countries: number; voices: string; from: string; logo: string };

/** How long the opening scene stays up before it crossfades into the first picture. */
const OPEN_MS = 7500;

export type FilmPlan = {
  opening?: FilmOpening;
  hash: string;
  width: number;
  height: number;
  fps: number;
  audio: { src: string; ms: number };
  totalMs: number;
  title: string;
  question: string;
  lang: string;
  scenes: PlanScene[];
  captions: { startMs: number; endMs: number; text: string }[];
  /** Feature books: quotes as lower-thirds and "how many said this" chips, over the pictures. */
  overlays?: Overlay[];
  style?: "documentary";
  credit: string;
  uploadId: string;
  chunkBytes: number;
};

const assetUrl = (bookId: string, key: string) => `/api/books/${bookId}/media/meta/asset?key=${encodeURIComponent(key)}`;

/** Flags are drawn from bundled SVGs in code (never by an image model), most voices first. */
async function openingOf(bookId: string, doc: BookDocument, lang: string): Promise<FilmOpening> {
  const ids = [...new Set((doc.outline?.clusters ?? []).flatMap((c) => c.voiceIds))];
  const rows = await prisma.voice
    .findMany({ where: ids.length ? { id: { in: ids } } : { bookId, status: "READY", hidden: false }, select: { countryCode: true } })
    .catch(() => [] as { countryCode: string | null }[]);
  const counts = new Map<string, number>();
  for (const row of rows) {
    const code = (row.countryCode ?? "").trim().toLowerCase();
    if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  const people = doc.outline?.total || rows.length;
  const countries = doc.outline?.countries ?? counts.size;
  const say = phrasesFor(lang);
  const flags = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([code]) => code)
    .filter((code) => FLAG_CODES.has(code))
    .map((code) => `/flags/${code}.svg`);
  return { flags, people, countries, voices: people > 0 ? say.voices(people) : "", from: countries > 0 ? say.countries(countries) : "", logo: "/brand/logo.svg" };
}

export async function filmPlan(bookId: string): Promise<FilmPlan> {
  const state = await readVideo(bookId);
  const run = state.run;
  if (!run || (run.status !== "assemble" && run.status !== "ready") || !run.audio) throw new AppError("The video book is not ready to put together yet.");
  const { docs } = await documentsFor(bookId);
  const doc = docs.get(run.lang);
  if (!doc) throw new AppError("The book changed. Press Make again.");
  const audio = run.audio;
  let cues: TimedCue[] = [];
  if (audio.cuesKey) cues = JSON.parse((await getAudio(audio.cuesKey).catch(() => Buffer.from("[]"))).toString("utf8")) as TimedCue[];
  if (isFeatureBook(doc)) return documentaryPlan(bookId, run, doc, cues);
  const scenes: PlanScene[] = [];
  const captions: FilmPlan["captions"] = [];
  const pictures = new Map(run.pictures.filter((p) => p.key).map((p) => [p.id, p.key!]));
  for (const unit of run.units) {
    const times = audio.units.find((u) => u.unit === unit.unit);
    if (!times || !unit.key) continue;
    const script = await readScript(unit.scriptKey);
    const board = await readBoard(unit.key);
    const unitCues = cues.filter((c) => c.unit === unit.unit);
    if (!unitCues.length) {
      // No timings saved: spread the script over the chapter by length.
      const total = script.segments.reduce((sum, s) => sum + s.text.length, 0) || 1;
      let at = times.startMs;
      script.segments.forEach((segment, seg) => {
        const length = (times.ms * segment.text.length) / total;
        unitCues.push({ unit: unit.unit, seg, startMs: Math.round(at), endMs: Math.round(at + length * 0.92), text: segment.text });
        at += length;
      });
    }
    for (const cue of unitCues) captions.push(...captionChunks(cue));
    const segmentStart = (segment: number) => {
      const cue = unitCues.find((c) => c.seg >= segment);
      return cue ? cue.startMs : times.startMs + (times.ms * segment) / Math.max(1, script.segments.length);
    };
    const quotes = unitQuotes(doc, unit.unit);
    board.scenes.forEach((scene, index) => {
      const startMs = index === 0 ? times.startMs : Math.max(times.startMs, Math.round(segmentStart(scene.segment)));
      const next = board.scenes[index + 1];
      const endMs = next ? Math.max(startMs + 1000, Math.round(segmentStart(next.segment))) : times.startMs + times.ms;
      const base: PlanScene = { startMs, endMs, unit: unit.unit, kind: "card", title: unit.unit === 0 ? doc.title : unit.title, subtitle: unit.unit === 0 ? doc.question : doc.title };
      if (unit.unit === 0 && index === 0) {
        // The film opens on the title card; a picture planned for the opening follows it once the title has been seen.
        const key = scene.kind === "picture" && scene.prompt ? pictures.get(pictureId(fullPrompt(scene.prompt, run.art), run.image.value)) : undefined;
        if (key && endMs - startMs > OPEN_MS + 4000) {
          scenes.push({ startMs, endMs: startMs + OPEN_MS, kind: "opening", title: doc.title, subtitle: doc.question });
          scenes.push({ startMs: startMs + OPEN_MS, endMs, unit: 0, kind: "picture", image: assetUrl(bookId, key) });
          return;
        }
        Object.assign(base, { kind: "opening", title: doc.title, subtitle: doc.question });
      } else if (scene.kind === "quote" && scene.quote !== undefined && quotes[scene.quote]) Object.assign(base, { kind: "quote", quote: quotes[scene.quote] });
      else if (scene.kind === "picture" && scene.prompt) {
        const key = pictures.get(pictureId(fullPrompt(scene.prompt, run.art), run.image.value));
        if (key) Object.assign(base, { kind: "picture", image: assetUrl(bookId, key) });
      }
      if (index === 0 && unit.unit > 0) base.chapter = unit.title;
      scenes.push(base);
    });
  }
  // Scenes never overlap or leave gaps.
  scenes.sort((a, b) => a.startMs - b.startMs);
  for (let i = 0; i < scenes.length - 1; i += 1) scenes[i].endMs = Math.max(scenes[i].startMs + 500, scenes[i + 1].startMs);
  if (scenes.length) scenes[scenes.length - 1].endMs = audio.ms;
  // Nothing stays still too long: long quotes and cards hand over to pictures.
  const paced = paceScenes(scenes, CARD_MS);
  scenes.length = 0;
  scenes.push(...paced);
  scenes.push({ startMs: audio.ms, endMs: audio.ms + END_MS, kind: "end", title: doc.title });
  const credit = filmCredit(run);
  return {
    opening: await openingOf(bookId, doc, run.lang),
    hash: run.planHash ?? planHashOf(run),
    width: 1280,
    height: 720,
    fps: 24,
    audio: { src: assetUrl(bookId, audio.key), ms: audio.ms },
    totalMs: audio.ms + END_MS,
    title: doc.title,
    question: doc.question,
    lang: run.lang,
    scenes,
    captions: captions.filter((c) => c.endMs > c.startMs),
    credit,
    uploadId: run.id,
    chunkBytes: CHUNK_BYTES,
  };
}

/** A documentary: long picture scenes that follow the outline, quotes and counts over the pictures, then credits. */
async function documentaryPlan(bookId: string, run: VideoRun, doc: BookDocument, cues: TimedCue[]): Promise<FilmPlan> {
  const audio = run.audio!;
  const scenes: PlanScene[] = [];
  const captions: FilmPlan["captions"] = [];
  const overlays: Overlay[] = [];
  const pictures = new Map(run.pictures.filter((p) => p.key).map((p) => [p.id, p.key!]));
  const outline = doc.outline;
  const clusters = new Map((outline?.clusters ?? []).map((c) => [c.id, c]));
  const standouts = new Map((outline?.standouts ?? []).map((s) => [s.voiceId, s]));
  let narrationEnd = 0;
  for (const unit of run.units) {
    const times = audio.units.find((u) => u.unit === unit.unit);
    if (!times || !unit.key) continue;
    const script = await readScript(unit.scriptKey);
    const board = await readBoard(unit.key);
    const unitCues = cues.filter((c) => c.unit === unit.unit);
    for (const cue of unitCues) captions.push(...captionChunks(cue));
    if (unitCues.length) narrationEnd = Math.max(narrationEnd, unitCues[unitCues.length - 1].endMs);
    const timeOf = (seg: number) => {
      const mine = unitCues.filter((c) => c.seg === seg);
      return mine.length ? { startMs: mine[0].startMs, endMs: mine[mine.length - 1].endMs } : null;
    };
    const segmentStart = (segment: number) => {
      const cue = unitCues.find((c) => c.seg >= segment);
      return cue ? cue.startMs : times.startMs + (times.ms * segment) / Math.max(1, script.segments.length);
    };
    const chapter = unit.unit > 0 ? doc.chapters[unit.unit - 1] : null;
    overlays.push(
      ...featureOverlays({
        segments: script.segments,
        timeOf,
        quoteAt: (index) => {
          const block = chapter?.blocks?.[index];
          const quote = block?.kind === "quote" ? chapter!.quotes.find((q) => q.id === block.quoteId && !q.hidden) : undefined;
          if (!quote) return null;
          const standout = standouts.get(quote.voiceId);
          return { text: quote.englishText, who: standout?.name || quote.speakerName, sub: standout?.name ? standout.place : "" };
        },
        countAt: (index) => {
          const block = chapter?.blocks?.[index];
          const cluster = block?.kind === "p" && block.cluster ? clusters.get(block.cluster) : undefined;
          return cluster ? { count: cluster.count, label: cluster.label } : null;
        },
      }),
    );
    board.scenes.forEach((scene, index) => {
      const startMs = index === 0 ? times.startMs : Math.max(times.startMs, Math.round(segmentStart(scene.segment)));
      const next = board.scenes[index + 1];
      const endMs = next ? Math.max(startMs + 4000, Math.round(segmentStart(next.segment))) : times.startMs + times.ms;
      const key = scene.kind === "picture" && scene.prompt ? pictures.get(pictureId(fullPrompt(scene.prompt, run.art), run.image.value)) : undefined;
      const chapterTitle = index === 0 && unit.unit > 0 && doc.form !== "continuous" ? unit.title : undefined;
      if (!key) {
        // A missing picture: the one before it holds on, so the film never drops to a blank card mid-story.
        const last = scenes[scenes.length - 1];
        if (last && last.kind === "picture") {
          last.endMs = endMs;
          if (chapterTitle) scenes.push({ ...last, startMs, endMs, chapter: chapterTitle });
          return;
        }
        scenes.push({ startMs, endMs, unit: unit.unit, kind: "card", title: chapterTitle ?? doc.title, subtitle: chapterTitle ? doc.title : doc.standfirst || doc.question });
        return;
      }
      if (unit.unit === 0 && index === 0 && endMs - startMs > OPEN_MS + 4000) {
        scenes.push({ startMs, endMs: startMs + OPEN_MS, kind: "opening", title: doc.title, subtitle: doc.standfirst || doc.question });
        scenes.push({ startMs: startMs + OPEN_MS, endMs, unit: 0, kind: "picture", image: assetUrl(bookId, key) });
        return;
      }
      scenes.push({ startMs, endMs, unit: unit.unit, kind: "picture", image: assetUrl(bookId, key), chapter: chapterTitle });
    });
  }
  if (!scenes.length || scenes[0].kind !== "opening") {
    // The opening always gets its full time: anything planned under it starts once it is over.
    const later = scenes.filter((scene) => scene.endMs > OPEN_MS + 1500);
    for (const scene of later) scene.startMs = Math.max(scene.startMs, OPEN_MS);
    scenes.length = 0;
    scenes.push({ startMs: 0, endMs: OPEN_MS, kind: "opening", title: doc.title, subtitle: doc.standfirst || doc.question }, ...later);
  }
  scenes.sort((a, b) => a.startMs - b.startMs);
  for (let i = 1; i < scenes.length; i += 1) if (scenes[i].startMs < scenes[i - 1].startMs + 500) scenes[i].startMs = scenes[i - 1].startMs + 500;
  for (let i = 0; i < scenes.length - 1; i += 1) scenes[i].endMs = scenes[i + 1].startMs;
  // How many took part is in the opening scene itself (with every country's flag).
  const total = outline?.total ?? 0;
  const countries = outline?.countries ?? 0;
  const creditsAt = Math.max(1000, Math.min(audio.ms, (narrationEnd || audio.ms) + 1200));
  if (scenes.length) scenes[scenes.length - 1].endMs = creditsAt;
  const totalMs = Math.max(audio.ms, creditsAt + 8000);
  const named = [...new Set((outline?.standouts ?? []).map((s) => s.name).filter(Boolean))];
  const credits = [
    total > 1 ? `Made from the voices of ${total} people${countries > 1 ? ` in ${countries} countries` : ""}` : "Made from the voices of real people",
    named.length ? `Quoted: ${named.slice(0, 8).join(" · ")}${named.length > 8 ? " and others" : ""}` : "",
  ].filter(Boolean);
  scenes.push({ startMs: creditsAt, endMs: totalMs, kind: "end", title: doc.title, credits });
  return {
    opening: await openingOf(bookId, doc, run.lang),
    hash: run.planHash ?? planHashOf(run),
    width: 1280,
    height: 720,
    fps: 24,
    audio: { src: assetUrl(bookId, audio.key), ms: audio.ms },
    totalMs,
    title: doc.title,
    question: doc.question,
    lang: run.lang,
    scenes,
    captions: captions.filter((c) => c.endMs > c.startMs),
    overlays: overlays.filter((o) => o.startMs < creditsAt).map((o) => ({ ...o, endMs: Math.min(o.endMs, creditsAt) })),
    style: "documentary",
    credit: filmCredit(run),
    uploadId: run.id,
    chunkBytes: CHUNK_BYTES,
  };
}

function filmCredit(run: VideoRun) {
  const parts = [`Words: ${run.audio?.writer.split(" · ")[0] || "the book"}`];
  if (run.writer.value) parts.push(`Scenes: ${run.writer.label.split(" · ")[0]}`);
  if (run.pictures.some((p) => p.key)) parts.push(`Pictures: ${run.image.label.split(" · ")[0]}`);
  parts.push(`Voice: ${(run.audio?.voice ?? "Meta MMS-TTS").split(" · ")[0]}`);
  return parts.join(" · ").replace("Words: Plain script (no AI model)", "Words: the book");
}

/* ---------- Upload of the finished film ---------- */

const chunkKey = (bookId: string, uploadId: string, part: number) => `book-${bookId}-mm-vup-${uploadId}-${part}.bin`;

export async function saveChunk(bookId: string, uploadId: string, part: number, bytes: Buffer) {
  const state = await readVideo(bookId);
  if (state.run?.status !== "assemble" || state.run.id !== uploadId) throw new AppError("This upload is not expected. Press Make again.", 409);
  if (!Number.isInteger(part) || part < 0 || part > Math.ceil(MAX_FILM_BYTES / CHUNK_BYTES)) throw new AppError("Bad part number.");
  if (!bytes.length || bytes.length > CHUNK_BYTES) throw new AppError("Bad part size.");
  await putAudio(chunkKey(bookId, uploadId, part), bytes, "application/octet-stream");
}

export async function finishFilm(bookId: string, input: { uploadId: string; parts: number; ms: number; codec: string }) {
  const state = await readVideo(bookId);
  const run = state.run;
  if (!run || run.status !== "assemble" || run.id !== input.uploadId) throw new AppError("This film is not expected. Press Make again.", 409);
  const chunks: Buffer[] = [];
  let total = 0;
  for (let part = 0; part < input.parts; part += 1) {
    const chunk = await getAudio(chunkKey(bookId, input.uploadId, part)).catch(() => null);
    if (!chunk) throw new AppError("Part of the film did not arrive. Press Make again.");
    total += chunk.length;
    if (total > MAX_FILM_BYTES) throw new AppError("The film is too large.");
    chunks.push(chunk);
  }
  const film = Buffer.concat(chunks);
  if (film.length < 1000 || film.toString("latin1", 4, 8) !== "ftyp") throw new AppError("The film file is not an MP4.");
  const key = `book-${bookId}-mm-video-${run.planHash ?? planHashOf(run)}.mp4`;
  const quoteScenes = await filmPlan(bookId)
    .then((plan) => plan.scenes.filter((s) => s.kind === "quote").length)
    .catch(() => 0);
  await putAudio(key, film, "video/mp4");
  for (let part = 0; part < input.parts; part += 1) await deleteAudio(chunkKey(bookId, input.uploadId, part)).catch(() => undefined);
  const book = await prisma.book.findUnique({ where: { id: bookId }, select: { videoKey: true } });
  if (book && !isUploadedKey(book.videoKey)) {
    await prisma.book.update({ where: { id: bookId }, data: { videoKey: key, videoBytes: film.length, videoName: "" } });
    if (book.videoKey && book.videoKey !== key && (isMetaMediaKey(book.videoKey) || /-video\.mp4$/.test(book.videoKey))) await deleteAudio(book.videoKey).catch(() => undefined);
  }
  if (state.video && state.video.key !== key && state.video.key !== book?.videoKey) await deleteAudio(state.video.key).catch(() => undefined);
  state.video = {
    key,
    bytes: film.length,
    ms: Math.round(input.ms) || run.audio?.ms || 0,
    hash: run.planHash ?? planHashOf(run),
    madeAt: new Date().toISOString(),
    writer: run.writer.label,
    image: run.image.label,
    voice: run.audio?.voice ?? "",
    pictures: run.pictures.filter((p) => p.key).length,
    quotes: quoteScenes,
    codec: input.codec.slice(0, 40),
  };
  run.status = "ready";
  run.phase = "Ready";
  run.finishedAt = new Date().toISOString();
  // Pictures no longer used by any film are removed.
  const used = new Set(run.pictures.map((p) => p.id));
  for (const [id, pictureKey] of Object.entries(state.cache.pictures)) {
    if (!used.has(id)) {
      await deleteAudio(pictureKey).catch(() => undefined);
      delete state.cache.pictures[id];
    }
  }
  await writeVideo(bookId, state);
  return videoProgressOf(state, null);
}

/** The browser could not put the film together: say so, keep everything made so far. */
export async function filmFailed(bookId: string, message: string) {
  const state = await readVideo(bookId);
  if (state.run?.status !== "assemble") return videoProgressOf(state, null);
  state.run.status = "failed";
  state.run.error = `Your browser could not put the film together: ${message.slice(0, 200)}. Press Try again (nothing is drawn twice), or use Chrome or Edge.`;
  state.run.phase = "Stopped";
  await writeVideo(bookId, state);
  return videoProgressOf(state, null);
}

/* ---------- Studio ---------- */

export async function saveVideoPicks(bookId: string, picks: { writer?: string; images?: string; voice?: string }) {
  const state = await readVideo(bookId);
  if (typeof picks.writer === "string") state.picks.writer = picks.writer.slice(0, 200);
  if (typeof picks.images === "string") state.picks.images = picks.images.slice(0, 200);
  await writeVideo(bookId, state);
  if (typeof picks.voice === "string") {
    const { mainLang } = await documentsFor(bookId);
    await saveAudioPicks(bookId, { voices: { [mainLang]: picks.voice } });
  }
}

export async function videoPanel(bookId: string) {
  const state = await readVideo(bookId);
  const audioState = await readState(bookId);
  const docs = await documentsFor(bookId).catch(() => null);
  // Before release there is no book text yet: show the pickers for the book's own language.
  const lang = docs?.mainLang ?? (await prisma.book.findUnique({ where: { id: bookId }, select: { language: true } }))?.language ?? "en";
  const doc = docs?.docs.get(lang);
  const metaOnly = mediaMetaOnly();
  const [writers, images] = await Promise.all([writerOptions(bookId), imageOptions(bookId)]);
  const narration = audioState.audio[lang];
  const units = doc ? narrationUnits(doc) : 0;
  const words = doc ? JSON.stringify(doc).split(/\s+/).length : 0;
  const listenMin = narration ? narration.ms / 60_000 : words / 150;
  const pictureUse = images.find((o) => o.value === state.picks.images && o.usable) ?? images.find((o) => o.recommended);
  const picturesOn = Boolean(pictureUse && pictureUse.value !== "none");
  const pictures = picturesOn ? Math.min(MAX_PICTURES, doc && isFeatureBook(doc) ? Math.max(units, Math.round((listenMin * 60_000) / 30_000)) : units * 2) : 0;
  const usd = (picturesOn ? pictures * PICTURE_USD : 0) + (words * 1.3 * 1.25 + units * 450 * 1.25 + units * 1100 * 4.25) / 1e6 + (narration ? 0 : ((words * 1.4 + units * 350) * 1.25 + (words * 1.6 + units * 1300) * 4.25) / 1e6);
  return {
    metaOnly,
    lang,
    langName: bookLanguage(lang).name,
    writers,
    writerPicked: state.picks.writer,
    images,
    imagePicked: state.picks.images,
    voices: voiceOptions(lang, metaOnly),
    voicePicked: audioState.picks.audiobook.voices[lang] ?? "",
    narration: narration ? { ms: narration.ms, writer: narration.writer, voice: narration.voice } : null,
    progress: videoProgressOf(state, audioState),
    video: state.video ?? null,
    pictureNotes: (state.run?.pictures ?? []).filter((p) => p.failed).length,
    estimate: {
      minutes: Math.max(1, Math.round(listenMin)),
      pictures,
      usd: Math.round(usd * 100) / 100,
      // Measured with the real key: about 20 s per picture batch of three, about 10 s per script, then the browser at about four times real time.
      makeMinutes: Math.max(1, Math.round((narration ? 0 : listenMin * 0.5) + (pictures / 3) * 0.5 + listenMin / 4 + 0.5)),
    },
    runsLeftToday: VIDEO_RUNS_PER_DAY - (state.starts?.day === today() ? state.starts.count : 0),
  };
}

/** For the book page: the Meta film's credit line, when the book's video is the Meta one. */
export async function readerFilm(book: { id: string; videoKey: string | null }): Promise<{ credit: string; sub: string } | null> {
  if (!isMetaMediaKey(book.videoKey)) return null;
  const state = await readVideo(book.id);
  if (!state.video || state.video.key !== book.videoKey) return null;
  const parts = [state.video.pictures ? "Pictures" : "Styled cards", "quotes", "captions", "the Meta voice"];
  const credit = state.run?.status === "ready" && state.run.planHash === state.video.hash ? filmCredit(state.run) : `Voice: ${state.video.voice.split(" · ")[0]}`;
  return { sub: `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`, credit };
}
