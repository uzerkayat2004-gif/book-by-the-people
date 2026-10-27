import "server-only";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ffmpeg } from "../media/tools";

/** Muse Voice Transcribe accepts mono 16-bit PCM WAV at 16 kHz or 24 kHz. */
export async function convertToWavPcm(input: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "bbtp-"));
  const source = path.join(dir, `in-${randomUUID()}`);
  const target = path.join(dir, "voice.wav");
  try {
    await writeFile(source, input);
    await ffmpeg(["-y", "-i", source, "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", "-map_metadata", "-1", target], 60_000);
    return await readFile(target);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ffmpeg failed";
    throw new Error(`Could not convert the recording to WAV for Muse Voice Transcribe. ${message}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
