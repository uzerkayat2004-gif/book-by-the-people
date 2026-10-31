// Book by the People: in-browser speech to text (Whisper Base, transformers.js).
// Runs in a Web Worker so the page never freezes. Audio stays on this device:
// the only network traffic is the one-time model download (cached in Cache Storage).
//
// Messages to the page:
//   { type: "status", stage: "downloading" | "loading" | "warming" | "retrying", device, attempt?, error? }
//   { type: "progress", loaded, total, files, done }
//   { type: "ready", device, loadMs, warmMs, bytes, threads, downloaded }
//   { type: "error", message, gpu }  (gpu: the page should retry on a fresh CPU worker)
//   { type: "text", id, text, ms, seconds, device, error?, gpuFailed? }
import { pipeline, env } from "/voice/transformers-3.8.1.min.js";

env.allowLocalModels = false;
env.useBrowserCache = true; // Cache Storage "transformers-cache": download once.

const MODEL = "onnx-community/whisper-base";
const cores = self.navigator?.hardwareConcurrency || 2;
const defaultThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, cores - 1)) : 1;
env.backends.onnx.wasm.numThreads = defaultThreads;

const WEBGPU_LOAD_LIMIT_MS = 60_000; // a GPU that takes longer than this to start is not worth it.

let asr = null;
let device = "wasm";
let loading = null;
let cachedNow = false;

const post = (m) => self.postMessage(m);
const errText = (err) => String(err?.message || err || "unknown error").slice(0, 300);

async function hasWebGPU() {
  try {
    if (!self.navigator?.gpu) return false;
    return !!(await self.navigator.gpu.requestAdapter());
  } catch {
    return false;
  }
}

function dtypeFor(dev) {
  // WASM: int8 everywhere (~77 MB). WebGPU (opt-in): 4-bit encoder + int8 decoder (~73 MB).
  return dev === "webgpu"
    ? { encoder_model: "q4", decoder_model_merged: "q8" }
    : { encoder_model: "q8", decoder_model_merged: "q8" };
}

function withTimeout(p, ms, what) {
  let t;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what} took longer than ${Math.round(ms / 1000)} s`)), ms); }),
  ]);
}

// Byte progress across every file. Small files may not send a size; they count once finished.
function tracker() {
  const files = new Map(); // file -> { loaded, total, done }
  let downloaded = false;
  let lastPost = 0;
  let announced = false;
  const sum = () => {
    let loaded = 0, total = 0, done = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += Math.max(f.total, f.loaded);
      if (f.done) done++;
    }
    return { loaded, total, files: files.size, done };
  };
  const onProgress = (p) => {
    if (!p || !p.file) return;
    if (p.status === "download") downloaded = true;
    const f = files.get(p.file) || { loaded: 0, total: 0, done: false };
    if (p.status === "progress") {
      downloaded = true;
      f.loaded = p.loaded || 0;
      f.total = p.total || 0;
    }
    if (p.status === "done") {
      f.done = true;
      f.total = Math.max(f.total, f.loaded);
      f.loaded = f.total;
    }
    files.set(p.file, f);
    const now = performance.now();
    if (p.status !== "progress" || now - lastPost > 150) {
      lastPost = now;
      post({ type: "progress", ...sum() });
    }
    const s = sum();
    if (!announced && !cachedNow && s.files >= 2 && s.done === s.files && /\.onnx$/.test(p.file)) {
      announced = true;
      post({ type: "status", stage: "loading", device });
    }
  };
  return { onProgress, sum, wasDownloaded: () => downloaded };
}

async function build(dev, t) {
  device = dev;
  post({ type: "status", stage: cachedNow ? "loading" : "downloading", device: dev });
  return pipeline("automatic-speech-recognition", MODEL, { device: dev, dtype: dtypeFor(dev), progress_callback: t.onProgress });
}

async function warm(p) {
  post({ type: "status", stage: "warming", device });
  // A short tone-free clip compiles the kernels so the first real chunk is quick.
  await p(new Float32Array(16000), { language: "en", task: "transcribe" });
}

async function loadOn(dev, t) {
  const p = await build(dev, t);
  try {
    await (dev === "webgpu" ? withTimeout(warm(p), WEBGPU_LOAD_LIMIT_MS, "Starting the GPU") : warm(p));
  } catch (err) {
    try { await p.dispose?.(); } catch {}
    throw err;
  }
  return p;
}

async function inCache(dev) {
  try {
    const keys = await (await caches.open("transformers-cache")).keys();
    const need = dev === "webgpu" ? ["encoder_model_q4.onnx", "decoder_model_merged_quantized.onnx"] : ["encoder_model_quantized.onnx", "decoder_model_merged_quantized.onnx"];
    return need.every((n) => keys.some((k) => k.url.includes(n)));
  } catch {
    return false;
  }
}

async function load(prefer, threads) {
  if (threads) env.backends.onnx.wasm.numThreads = threads;
  const t0 = performance.now();
  const t = tracker();
  // Default is WebAssembly: it works the same on every computer. WebGPU only when asked (?device=webgpu).
  // ONNX Runtime cannot switch backends inside one worker, so a failed GPU start is reported as
  // { gpu: true } and the page starts a fresh CPU worker.
  const want = prefer === "webgpu" && (await hasWebGPU()) ? "webgpu" : "wasm";
  const cached = await inCache(want);
  cachedNow = cached;
  if (want === "webgpu") {
    asr = await withTimeout(loadOn("webgpu", t), WEBGPU_LOAD_LIMIT_MS * 3, "Loading on the GPU");
  } else {
    let attempt = 0;
    for (;;) {
      attempt++;
      try {
        asr = await loadOn("wasm", t);
        break;
      } catch (err) {
        // Network hiccups (a file stopped half way, a CDN error): try again a couple of times.
        if (attempt >= 3) throw err;
        post({ type: "status", stage: "retrying", device, attempt, error: errText(err) });
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
  }
  const loadMs = performance.now() - t0;
  return { device, loadMs, warmMs: 0, bytes: t.sum().total, downloaded: !cached, threads: device === "wasm" ? env.backends.onnx.wasm.numThreads : 0 };
}

const NOISE = /^\s*[\[(][^\])]*[\])]\s*$/; // "[BLANK_AUDIO]", "(music)", ...

// Whisper Base drifts between scripts on Hindi (Urdu letters, romanised Hindi, even Tamil). For
// languages written in one script we only allow tokens in that script. Tokens are byte-level
// (GPT-2 style): ASCII stays as is, a space is "Ġ", and every UTF-8 byte >= 0x80 is one char.
// Devanagari is E0 A4 xx / E0 A5 xx, so its tokens hold only "à", "¤", "¥" and continuation bytes.
const CONT = "\u0121-\u0143\u00A1-\u00BF"; // UTF-8 continuation bytes 0x80-0xBF as token chars
const ASCII_MARKS = "\u0021-\u0040\u005B-\u0060\u007B-\u007E\u0120\u010A\u0109"; // punctuation, digits, space, newline, tab
const DEVANAGARI_ONLY = new RegExp(`^[${ASCII_MARKS}${CONT}\u00E0]+$`);
const devanagari = (t) => DEVANAGARI_ONLY.test(t) && !/\u00E0[^\u00A4\u00A5]/.test(t);
const latin = (t) => /^[\u0021-\u007E\u0120\u010A\u0109]+$/.test(t);
const arabicFree = (t) => !/[\u00D8-\u00DB]/.test(t);
const devanagariFree = (t) => !/\u00E0[\u00A4\u00A5]/.test(t);
/** Which tokens are allowed per language (others are banned). */
const ALLOW = {
  hi: devanagari,
  mr: devanagari,
  ne: devanagari,
  hinglish: latin, // Hindi said, written in Latin letters
  pa: arabicFree,
  ur: devanagariFree,
};
const WHISPER_CODE = { hinglish: "hi" };
const banned = new Map();
function bannedFor(language) {
  const allow = ALLOW[language];
  if (!allow || !asr?.tokenizer) return null;
  if (banned.has(language)) return banned.get(language);
  let list = null;
  try {
    const vocab = asr.tokenizer.model?.vocab;
    const entries = Array.isArray(vocab) ? vocab.map((t, i) => [t, i]) : Object.entries(asr.tokenizer.get_vocab?.() || {});
    list = [];
    for (const [token, id] of entries) {
      if (typeof token !== "string" || /^<\|.*\|>$/.test(token)) continue; // keep special tokens
      if (!allow(token)) list.push([Number(id)]);
    }
    if (!list.length) list = null;
  } catch {
    list = null;
  }
  banned.set(language, list);
  return list;
}

// Whisper sometimes loops on one word ("the the the ..."). Cap the length to what a person can say,
// and fold any word said more than 3 times in a row.
function unloop(text) {
  return text
    .replace(/\uFFFD+/g, "")
    .replace(/(\S+)(?:\s+\1){3,}/gu, "$1")
    .replace(/(\S{1,6}?)\1{6,}/gu, "$1");
}

async function run(audio, language) {
  const seconds = audio.length / 16000;
  const opts = { task: "transcribe", max_new_tokens: Math.min(440, Math.ceil(seconds * 30) + 24) };
  if (language && language !== "auto") {
    opts.language = WHISPER_CODE[language] || language;
    const bad = bannedFor(language);
    if (bad) opts.bad_words_ids = bad;
  }
  if (audio.length > 30 * 16000) { opts.chunk_length_s = 30; opts.stride_length_s = 5; delete opts.max_new_tokens; }
  const out = await asr(audio, opts);
  let text = (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out?.text || "").trim();
  if (NOISE.test(text)) text = "";
  return unloop(text);
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type === "load") {
    try {
      loading ||= load(msg.device, msg.threads);
      const info = await loading;
      post({ type: "ready", ...info });
    } catch (err) {
      loading = null;
      asr = null;
      post({ type: "error", message: errText(err), gpu: device === "webgpu" });
    }
    return;
  }
  if (msg.type === "transcribe") {
    const seconds = msg.audio.length / 16000;
    const t0 = performance.now();
    try {
      if (!asr) await loading;
      if (!asr) throw new Error("voice model is not loaded");
      let text = "", gpuFailed = "";
      try {
        text = await run(msg.audio, msg.language);
      } catch (err) {
        if (device !== "webgpu") throw err;
        gpuFailed = errText(err);
      }
      // GPU gave an error or nothing for real speech: the page redoes this chunk on a CPU worker.
      if (device === "webgpu" && !gpuFailed && !text && msg.speech) gpuFailed = "empty result";
      if (gpuFailed) {
        post({ type: "text", id: msg.id, text: "", gpuFailed, ms: performance.now() - t0, seconds, device });
        return;
      }
      post({ type: "text", id: msg.id, text, ms: performance.now() - t0, seconds, device });
    } catch (err) {
      post({ type: "text", id: msg.id, text: "", error: errText(err), ms: performance.now() - t0, seconds, device });
    }
  }
};
