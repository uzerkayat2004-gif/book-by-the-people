import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, chmodSync, execFileAsync } from "@/lib/runtime-fs";
import { mkdtemp, readFile, rm, writeFile } from "@/lib/runtime-fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { modelsDir } from "../ai/local-runtime";

const exec = execFileAsync;

/**
 * Audio and video tools: ffmpeg (convert recordings, mp3, video) and a speech
 * engine for the audiobook. Every step has a real path on Windows, macOS and
 * Linux, and nothing here fakes a result: a missing tool is reported by name.
 */

/** Pinned single-file ffmpeg builds (ffmpeg-static b6.1.1). Windows build includes mp3, x264 and drawtext. */
export const FFMPEG_RELEASE = "b6.1.1";
const FFMPEG_ASSETS: Record<string, { asset: string; bytes: number }> = {
  "win32-x64": { asset: "ffmpeg-win32-x64.gz", bytes: 29_581_307 },
  "linux-x64": { asset: "ffmpeg-linux-x64.gz", bytes: 29_354_986 },
  "linux-arm64": { asset: "ffmpeg-linux-arm64.gz", bytes: 25_568_691 },
  "darwin-x64": { asset: "ffmpeg-darwin-x64.gz", bytes: 25_296_431 },
  "darwin-arm64": { asset: "ffmpeg-darwin-arm64.gz", bytes: 19_246_198 },
};

export function ffmpegAsset(platform = process.platform, arch = process.arch) {
  const found = FFMPEG_ASSETS[`${platform}-${arch}`];
  return found ? { ...found, url: `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_RELEASE}/${found.asset}` } : null;
}

/** Where the one-click ffmpeg goes: next to the local model runtime. */
export async function toolsDir(): Promise<string> {
  return path.join((await modelsDir()).path, "runtime", "tools");
}

async function bundledFfmpeg(): Promise<string> {
  return path.join(await toolsDir(), process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
}

const probed = new Map<string, boolean>();
async function runs(command: string, args: string[]): Promise<boolean> {
  const key = `${command} ${args.join(" ")}`;
  const known = probed.get(key);
  if (known !== undefined) return known;
  let ok = false;
  try {
    await exec(command, args, { timeout: 15_000, windowsHide: true });
    ok = true;
  } catch {
    ok = false;
  }
  // Only remember a success; a missing tool may be installed while the app runs.
  if (ok) probed.set(key, true);
  return ok;
}

/** FFMPEG_PATH, then the one-click copy, then ffmpeg on PATH. Null when none runs. */
export async function ffmpegBin(): Promise<string | null> {
  const fromEnv = process.env.FFMPEG_PATH?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const bundled = await bundledFfmpeg();
  if (existsSync(bundled)) return bundled;
  return (await runs("ffmpeg", ["-version"])) ? "ffmpeg" : null;
}

export const NO_FFMPEG = "ffmpeg is not installed. Get it in Book settings → AI model → Audio tools.";

/** Runs ffmpeg with the given arguments, or throws NO_FFMPEG. */
export async function ffmpeg(args: string[], timeoutMs = 120_000): Promise<void> {
  const bin = await ffmpegBin();
  if (!bin) throw new Error(NO_FFMPEG);
  await exec(bin, ["-hide_banner", "-loglevel", "error", ...args], { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
}

let installing: Promise<string> | null = null;

/** Downloads the pinned ffmpeg build for this computer (about 30 MB). */
export function installFfmpeg(): Promise<string> {
  if (installing) return installing;
  installing = (async () => {
    const asset = ffmpegAsset();
    if (!asset) throw new Error(`No ready-made ffmpeg for ${process.platform}/${process.arch}. Install ffmpeg and set FFMPEG_PATH.`);
    const dir = await toolsDir();
    mkdirSync(dir, { recursive: true });
    const target = await bundledFfmpeg();
    const part = `${target}.part`;
    const response = await fetch(asset.url, { redirect: "follow" });
    if (!response.ok || !response.body) throw new Error(`Could not download ffmpeg (HTTP ${response.status}).`);
    try {
      await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), createGunzip(), createWriteStream(part));
      if (process.platform !== "win32") chmodSync(part, 0o755);
      rmSync(target, { force: true });
      renameSync(part, target);
    } catch (error) {
      rmSync(part, { force: true });
      throw error;
    }
    try {
      await exec(target, ["-version"], { timeout: 20_000, windowsHide: true });
    } catch {
      rmSync(target, { force: true });
      throw new Error("ffmpeg downloaded but did not start on this computer.");
    }
    return target;
  })().finally(() => {
    installing = null;
  });
  return installing;
}

export type SpeechEngine = "http" | "espeak-ng" | "espeak" | "windows" | "macos";

export const SPEECH_NAMES: Record<SpeechEngine, string> = {
  http: "TTS server",
  "espeak-ng": "eSpeak NG",
  espeak: "eSpeak",
  windows: "Windows voice",
  macos: "macOS voice",
};

/** The first speech engine that works here. Windows has one built in (SAPI). */
export async function speechEngine(): Promise<SpeechEngine | null> {
  const provider = (process.env.TTS_PROVIDER || "").toLowerCase();
  if (provider === "http" && process.env.TTS_URL) return "http";
  if (await runs("espeak-ng", ["--version"])) return "espeak-ng";
  if (await runs("espeak", ["--version"])) return "espeak";
  if (process.platform === "win32" && (await runs("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Add-Type -AssemblyName System.Speech"]))) return "windows";
  if (process.platform === "darwin" && existsSync("/usr/bin/say")) return "macos";
  return null;
}

export const NO_SPEECH = "No speech engine on this computer. Install eSpeak NG, or set TTS_PROVIDER=http with TTS_URL.";

const WINDOWS_SPEAK = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -AssemblyName System.Speech",
  "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
  "try { $s.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::NotSet, [System.Speech.Synthesis.VoiceAge]::NotSet, 0, [System.Globalization.CultureInfo]::GetCultureInfo('en-US')) } catch {}",
  "$s.Rate = 0",
  "$s.SetOutputToWaveFile($env:BBTP_TTS_OUT)",
  "$s.Speak([System.IO.File]::ReadAllText($env:BBTP_TTS_IN, [System.Text.Encoding]::UTF8))",
  "$s.Dispose()",
].join("; ");

/** Speaks text into a WAV buffer with the first engine that works. Throws NO_SPEECH when there is none. */
export async function speakToWav(text: string, options: { espeakVoice?: string } = {}): Promise<{ wav: Buffer; engine: SpeechEngine }> {
  const engine = await speechEngine();
  if (!engine) throw new Error(NO_SPEECH);
  if (engine === "http") {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.TTS_API_KEY) headers.Authorization = `Bearer ${process.env.TTS_API_KEY}`;
    const response = await fetch(process.env.TTS_URL!, { method: "POST", headers, body: JSON.stringify({ text }) });
    if (!response.ok) throw new Error(`The TTS server failed (HTTP ${response.status}).`);
    return { wav: Buffer.from(await response.arrayBuffer()), engine };
  }
  const dir = await mkdtemp(path.join(tmpdir(), "bbtp-tts-"));
  const input = path.join(dir, "text.txt");
  const wav = path.join(dir, "speech.wav");
  // Long books take a while; about 10 minutes covers a 60k-character script on a slow laptop.
  const timeout = Math.max(60_000, Math.min(900_000, text.length * 15));
  try {
    await writeFile(input, text, "utf8");
    if (engine === "espeak-ng" || engine === "espeak") {
      await exec(engine, ["-v", options.espeakVoice || "en-us", "-s", "152", "-w", wav, "-f", input], { timeout, windowsHide: true });
    } else if (engine === "windows") {
      await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", WINDOWS_SPEAK], {
        timeout,
        windowsHide: true,
        env: { ...process.env, BBTP_TTS_IN: input, BBTP_TTS_OUT: wav },
      });
    } else {
      await exec("/usr/bin/say", ["--file-format=WAVE", "--data-format=LEI16@22050", "-o", wav, "-f", input], { timeout });
    }
    const out = await readFile(wav);
    if (out.length < 100) throw new Error(`${SPEECH_NAMES[engine]} made an empty file.`);
    return { wav: out, engine };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A short status for the settings page. */
export async function toolsStatus() {
  const [bin, speech, bundled] = await Promise.all([ffmpegBin(), speechEngine(), bundledFfmpeg()]);
  const asset = ffmpegAsset();
  return {
    ffmpeg: bin ? (bin === "ffmpeg" ? "installed" : bin === bundled ? "downloaded" : "FFMPEG_PATH") : null,
    ffmpegDownloadBytes: asset?.bytes ?? null,
    speech: speech ? SPEECH_NAMES[speech] : null,
  };
}
