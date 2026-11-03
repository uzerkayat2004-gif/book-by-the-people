import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BookDocument } from "../book/types";
import { narrationScript } from "./script";
import { mediaVersionKey } from "./version";
import { wavDurationMs } from "../book/speech";
import { prisma } from "../db";
import { putAudio } from "../storage";
import { wavToMp3 } from "./js-audio";
import { SPEECH_NAMES, ffmpeg, ffmpegBin, speakToWav } from "./tools";

const FONT_CANDIDATES = [
  process.env.MEDIA_FONT ?? "",
  "/usr/share/fonts/truetype/macos/Inter-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/Library/Fonts/Arial Bold.ttf",
  "C:\\Windows\\Fonts\\segoeuib.ttf",
  "C:\\Windows\\Fonts\\arialbd.ttf",
];

/** drawtext wants forward slashes, an escaped drive colon and quotes: 'C\:/Windows/Fonts/arialbd.ttf'. */
export function drawtextFont(file: string): string {
  return `'${file.replace(/\\/g, "/").replace(/'/g, "").replace(/:/g, "\\:")}'`;
}

function fontOption(): string {
  const file = FONT_CANDIDATES.find((candidate) => candidate && existsSync(candidate));
  return file ? `fontfile=${drawtextFont(file)}:` : "";
}

export { narrationScript };

/** Files the creator uploaded are stored as book-<id>-<kind>-upload.<ext>; anything else was made here. */
export const isUploadedKey = (key: string | null | undefined) => /-upload\.[a-z0-9]+$/i.test(key ?? "");

/** Files the Meta audiobook pipeline made (book-<id>-mm-…). The built-in voice never replaces them on its own. */
export const isMetaMediaKey = (key: string | null | undefined) => /-mm-/.test(key ?? "");

export { MEDIA_VERSION, mediaVersionKey } from "./version";

/** Video is a still cover under the narration. Hosts without ffmpeg (Vercel) skip it; MEDIA_VIDEO=off skips it anywhere. */
export function videoWanted(): boolean {
  return (process.env.MEDIA_VIDEO || "").toLowerCase() !== "off";
}

function escapeDrawtext(value: string): string {
  return value.replace(/\\/g, "").replace(/:/g, " ").replace(/'/g, "").replace(/%/g, "").slice(0, 72);
}

export async function synthesizeSpeech(text: string): Promise<Buffer> {
  return (await speakToWav(text)).wav;
}

async function transcode(input: Buffer, args: string[], name: string): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "bbtp-media-"));
  const source = path.join(dir, "in.wav");
  const target = path.join(dir, name);
  try {
    await writeFile(source, input);
    await ffmpeg(["-y", "-i", source, ...args, target], 900_000);
    return await readFile(target);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function videoArgs(title: string, chapters: string, withText: boolean, seconds: number | null): string[] {
  const font = fontOption();
  const text = withText
    ? `,drawtext=${font}text='BOOK BY THE PEOPLE':fontsize=28:fontcolor=white:x=(w-text_w)/2:y=150,drawtext=${font}text='${title}':fontsize=22:fontcolor=white:x=(w-text_w)/2:y=210,drawtext=${font}text='${chapters}':fontsize=16:fontcolor=white:x=(w-text_w)/2:y=270`
    : "";
  return [
    "-f",
    "lavfi",
    "-i",
    "color=c=0x9b1c24:s=854x480:r=2",
    "-filter_complex",
    `[1:v]format=yuv420p${text}[v]`,
    "-map",
    "[v]",
    "-map",
    "0:a",
    ...(seconds ? ["-t", seconds.toFixed(2)] : ["-shortest"]),
    "-c:v",
    "libx264",
    "-tune",
    "stillimage",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-movflags",
    "+faststart",
  ];
}

export type MediaResult = { audio: boolean; video: boolean; note: string | null; engine: string | null };

/**
 * Speaks the book into an audiobook (mp3 when ffmpeg is there, otherwise wav) and,
 * with ffmpeg, a simple video. Uploaded files are kept unless `force` is set.
 */
export async function renderReleaseMedia(bookId: string, document: BookDocument, options: { force?: boolean } = {}): Promise<MediaResult> {
  const script = narrationScript(document);
  const spoken = await speakToWav(script);
  const wav = spoken.wav;
  const hasFfmpeg = Boolean(await ffmpegBin());
  let audio = wav;
  let audioMime = "audio/wav";
  let audioExt = "wav";
  const notes: string[] = [];
  if (hasFfmpeg) {
    try {
      audio = await transcode(wav, ["-codec:a", "libmp3lame", "-qscale:a", "6"], "book.mp3");
      audioMime = "audio/mpeg";
      audioExt = "mp3";
    } catch {
      audio = wav;
    }
  }
  if (audioExt === "wav") {
    // No ffmpeg (Vercel, a fresh laptop): encode the mp3 in JavaScript. A WAV is ten times larger.
    try {
      audio = await wavToMp3(wav);
      audioMime = "audio/mpeg";
      audioExt = "mp3";
    } catch {
      audio = wav;
    }
  }
  const title = escapeDrawtext(document.title || "Book by the People");
  const chapters = escapeDrawtext(document.chapters.map((chapter) => chapter.title).join("  ·  ") || document.question);
  let video: Buffer | null = null;
  const ms = wavDurationMs(wav);
  const seconds = ms ? ms / 1000 : null;
  if (hasFfmpeg && videoWanted()) {
    try {
      video = await transcode(wav, videoArgs(title, chapters, true, seconds), "book.mp4");
    } catch {
      // Some ffmpeg builds have no drawtext; a plain cover still carries the narration.
      try {
        video = await transcode(wav, videoArgs(title, chapters, false, seconds), "book.mp4");
      } catch (error) {
        notes.push(`Video failed: ${error instanceof Error ? error.message.split("\n")[0].slice(0, 160) : "ffmpeg error"}`);
      }
    }
  } else if (videoWanted() && !process.env.VERCEL) {
    notes.push("Video needs ffmpeg. Get it in Book settings → AI model → Audio tools.");
  }

  const current = await prisma.book.findUnique({ where: { id: bookId }, select: { audiobookName: true, videoName: true, audiobookKey: true, videoKey: true } });
  const data: { audiobookKey?: string; audiobookBytes?: number; audiobookName?: string; videoKey?: string | null; videoBytes?: number; videoName?: string } = {};
  let wroteAudio = false;
  let wroteVideo = false;
  if (options.force || !(isUploadedKey(current?.audiobookKey) || isMetaMediaKey(current?.audiobookKey))) {
    const audioKey = `book-${bookId}-audiobook.${audioExt}`;
    await putAudio(audioKey, audio, audioMime);
    data.audiobookKey = audioKey;
    data.audiobookBytes = audio.length;
    data.audiobookName = "";
    wroteAudio = true;
  }
  if (video && (options.force || !isUploadedKey(current?.videoKey))) {
    const videoKey = `book-${bookId}-video.mp4`;
    await putAudio(videoKey, video, "video/mp4");
    data.videoKey = videoKey;
    data.videoBytes = video.length;
    data.videoName = "";
    wroteVideo = true;
  }
  if (!video && current?.videoKey && !isUploadedKey(current.videoKey)) {
    // An old auto-made video no longer matches the new narration; drop it rather than show the wrong length.
    data.videoKey = null;
    data.videoBytes = 0;
    data.videoName = "";
  }
  await prisma.book.update({ where: { id: bookId }, data });
  const note = notes.join(" ") || null;
  await prisma.pipelineJob.upsert({
    where: { key: `${bookId}:make:media` },
    create: { bookId, step: "media", key: `${bookId}:make:media`, status: "done", lastError: note },
    update: { status: "done", lastError: note },
  });
  // Marks this book as narrated by the current script, so it is not redone on the next visit.
  await prisma.pipelineJob.upsert({
    where: { key: mediaVersionKey(bookId) },
    create: { bookId, step: "media", key: mediaVersionKey(bookId), status: "done" },
    update: { status: "done" },
  });
  return { audio: wroteAudio || Boolean(current?.audiobookKey), video: wroteVideo || Boolean(current?.videoKey), note, engine: SPEECH_NAMES[spoken.engine] };
}
