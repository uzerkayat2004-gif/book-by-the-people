import "server-only";
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "@/lib/runtime-fs";
import { mmsFor } from "./catalog";
import { PAUSE_MS, sentencePieces, speakableEnglish, tokenize, tokenizerFrom, type Segment, type VitsTokenizer } from "./text";

/**
 * Meta MMS-TTS on the server (onnxruntime-node, CPU, fp32). The quantised copy sounds broken, so it is never used.
 * Each language's model (about 114 MB) is downloaded once per server into a cache folder and reused.
 */
export const MMS_RATE = 16_000;
const SOURCE = process.env.MMS_TTS_SOURCE || "https://huggingface.co/Xenova";

type Ort = typeof import("onnxruntime-node");
type Loaded = { lang: string; session: import("onnxruntime-node").InferenceSession; tok: VitsTokenizer; ort: Ort };

let current: Promise<Loaded> | null = null;
let currentLang = "";

function cacheDir(): string {
  if (process.env.MMS_CACHE_DIR) return process.env.MMS_CACHE_DIR;
  return process.env.VERCEL ? "/tmp/mms" : path.resolve(/*turbopackIgnore: true*/ process.cwd(), "data", "models", "mms");
}

async function download(url: string, file: string, minBytes: number): Promise<void> {
  if (existsSync(file) && statSync(file).size >= minBytes) return;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(120_000), redirect: "follow" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const expected = Number(response.headers.get("content-length") || 0);
      if (bytes.length < minBytes || (expected && bytes.length !== expected)) throw new Error("download was cut short");
      const temp = `${file}.part`;
      writeFileSync(temp, bytes);
      renameSync(temp, file);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
  throw new Error(`The Meta voice could not be downloaded (${lastError instanceof Error ? lastError.message : "network"}).`);
}

async function load(lang: string): Promise<Loaded> {
  const mms = mmsFor(lang);
  if (!mms) throw new Error(`There is no Meta voice for this language (${lang}) yet.`);
  const dir = path.join(cacheDir(), mms.code);
  mkdirSync(dir, { recursive: true });
  const repo = `${SOURCE}/mms-tts-${mms.code}/resolve/main`;
  await download(`${repo}/tokenizer.json`, path.join(dir, "tokenizer.json"), 200);
  await download(`${repo}/onnx/model.onnx`, path.join(dir, "model.onnx"), 50_000_000);
  const ort = (await import("onnxruntime-node")) as unknown as Ort;
  const session = await ort.InferenceSession.create(path.join(dir, "model.onnx"), {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
  });
  const tok = tokenizerFrom(String(readFileSync(path.join(dir, "tokenizer.json"), "utf8")));
  return { lang: mms.code, session, tok, ort };
}

/** The loaded voice for a language. Only one language is kept in memory at a time. */
export async function mmsVoice(lang: string): Promise<Loaded> {
  const code = mmsFor(lang)?.code ?? lang;
  if (current && currentLang === code) {
    try {
      return await current;
    } catch {
      current = null;
    }
  }
  if (current) {
    const old = await current.catch(() => null);
    await old?.session.release().catch(() => undefined);
  }
  currentLang = code;
  current = load(lang);
  current.catch(() => {
    current = null;
  });
  return current;
}

/** One short piece of text → 16 kHz mono samples. */
export async function mmsSpeak(voice: Loaded, text: string): Promise<Float32Array> {
  const ids = tokenize(voice.tok, voice.lang === "eng" ? speakableEnglish(text) : text);
  if (!ids.length) return new Float32Array(0);
  const big = BigInt64Array.from(ids.map((id) => BigInt(id)));
  const mask = BigInt64Array.from(ids.map(() => BigInt(1)));
  const out = await voice.session.run({
    input_ids: new voice.ort.Tensor("int64", big, [1, ids.length]),
    attention_mask: new voice.ort.Tensor("int64", mask, [1, ids.length]),
  });
  const wave = out.waveform ?? out[voice.session.outputNames[0]];
  return Float32Array.from(wave.data as Float32Array);
}

/** Speaks segments with pauses between them. Returns 16-bit samples ready for the mp3 encoder. */
export async function mmsSpeakSegments(lang: string, segments: Segment[], onPiece?: (done: number, total: number) => void): Promise<Int16Array> {
  const voice = await mmsVoice(lang);
  const pieces: { text: string; gapMs: number }[] = [];
  for (const segment of segments) {
    const parts = sentencePieces(segment.text);
    parts.forEach((text, index) => pieces.push({ text, gapMs: index === parts.length - 1 ? PAUSE_MS[segment.pause] : PAUSE_MS.none }));
  }
  const chunks: Int16Array[] = [];
  let total = 0;
  for (const [index, piece] of pieces.entries()) {
    const audio = await mmsSpeak(voice, piece.text);
    const pcm = new Int16Array(audio.length + Math.round((piece.gapMs / 1000) * MMS_RATE));
    for (let i = 0; i < audio.length; i += 1) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(audio[i] * 32767 * 0.92)));
    chunks.push(pcm);
    total += pcm.length;
    onPiece?.(index + 1, pieces.length);
  }
  const all = new Int16Array(total);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  return all;
}

/** Frees the cached model files (tests and low disk). */
export function forgetMmsCache(): void {
  rmSync(cacheDir(), { recursive: true, force: true });
}
