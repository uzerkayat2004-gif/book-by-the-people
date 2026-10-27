import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { BookDocument } from "../book/types";
import { stripPeopleCounts } from "../book/checks";
import { prisma } from "../db";
import { putAudio } from "../storage";

const exec = promisify(execFile);
const FONT = "/usr/share/fonts/truetype/macos/Inter-Bold.ttf";

export function narrationScript(document: BookDocument): string {
  const parts: string[] = [];
  for (const chapter of document.chapters) {
    parts.push(chapter.title);
    for (const quote of chapter.quotes) {
      if (quote.hidden) continue;
      const text = stripPeopleCounts(quote.englishText);
      if (text) parts.push(text);
    }
  }
  const script = parts.join(". ").replace(/\s+/g, " ").trim();
  return (script || document.title).slice(0, 700);
}

function escapeDrawtext(value: string): string {
  return value.replace(/\\/g, "").replace(/:/g, " ").replace(/'/g, "").replace(/%/g, "").slice(0, 72);
}

export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const provider = (process.env.TTS_PROVIDER || "mock").toLowerCase();
  if (provider === "http" && process.env.TTS_URL) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.TTS_API_KEY) headers.Authorization = `Bearer ${process.env.TTS_API_KEY}`;
    const response = await fetch(process.env.TTS_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ text }),
    });
    if (!response.ok) throw new Error(`TTS provider failed (${response.status}).`);
    return Buffer.from(await response.arrayBuffer());
  }

  const dir = await mkdtemp(path.join(tmpdir(), "bbtp-tts-"));
  const wav = path.join(dir, "speech.wav");
  try {
    try {
      await exec("espeak-ng", ["-v", "en-us", "-s", "152", "-w", wav, text], { timeout: 30_000 });
    } catch {
      await exec(
        "ffmpeg",
        ["-y", "-f", "lavfi", "-i", "sine=frequency=196:duration=4", "-ac", "1", "-ar", "24000", wav],
        { timeout: 20_000 },
      );
    }
    return await readFile(wav);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function transcode(input: Buffer, args: string[], name: string): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "bbtp-media-"));
  const source = path.join(dir, "in.wav");
  const target = path.join(dir, name);
  try {
    await writeFile(source, input);
    await exec("ffmpeg", ["-y", "-i", source, ...args, target], { timeout: 45_000 });
    return await readFile(target);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function renderReleaseMedia(bookId: string, document: BookDocument) {
  const script = narrationScript(document);
  const wav = await synthesizeSpeech(script);
  let audio = wav;
  let audioMime = "audio/wav";
  let audioExt = "wav";
  try {
    audio = await transcode(wav, ["-codec:a", "libmp3lame", "-qscale:a", "8"], "book.mp3");
    audioMime = "audio/mpeg";
    audioExt = "mp3";
  } catch {
    audio = wav;
  }
  const title = escapeDrawtext(document.title || "Book by the People");
  const chapters = escapeDrawtext(document.chapters.map((chapter) => chapter.title).join("  ·  ") || document.question);
  let video: Buffer | null = null;
  try {
    video = await transcode(
      wav,
      [
        "-f",
        "lavfi",
        "-i",
        "color=c=0x9b1c24:s=854x480:d=8",
        "-filter_complex",
        `[1:v]drawtext=fontfile=${FONT}:text='BOOK BY THE PEOPLE':fontsize=28:fontcolor=white:x=(w-text_w)/2:y=150,drawtext=fontfile=${FONT}:text='${title}':fontsize=22:fontcolor=white:x=(w-text_w)/2:y=210,drawtext=fontfile=${FONT}:text='${chapters}':fontsize=16:fontcolor=white:x=(w-text_w)/2:y=270[v]`,
        "-map",
        "[v]",
        "-map",
        "0:a",
        "-shortest",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        "-movflags",
        "+faststart",
      ],
      "book.mp4",
    );
  } catch {
    video = null;
  }

  const audioKey = `book-${bookId}-audiobook.${audioExt}`;
  await putAudio(audioKey, audio, audioMime);
  const data: { audiobookKey: string; audiobookBytes: number; videoKey?: string; videoBytes?: number } = {
    audiobookKey: audioKey,
    audiobookBytes: audio.length,
  };
  if (video) {
    const videoKey = `book-${bookId}-video.mp4`;
    await putAudio(videoKey, video, "video/mp4");
    data.videoKey = videoKey;
    data.videoBytes = video.length;
  }
  await prisma.book.update({ where: { id: bookId }, data });
  await prisma.pipelineJob.upsert({
    where: { key: `${bookId}:make:media` },
    create: { bookId, step: "media", key: `${bookId}:make:media`, status: "done" },
    update: { status: "done", lastError: video ? null : "Video assembly did not finish. The audiobook is ready." },
  });
  return data;
}
