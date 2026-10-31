// In-browser voice typing for the Add your voice page. Microphone -> 16 kHz chunks split at pauses -> Whisper in a Web Worker.
// Nothing is uploaded: audio is processed on this device and thrown away after it becomes text.

export type ModelInfo = { device: string; loadMs: number; warmMs: number; bytes: number; threads?: number; downloaded?: boolean; fellBack?: string };
export type ChunkStat = { seconds: number; ms: number; device?: string; error?: string; retried?: boolean; empty?: boolean };
export type LoadStage = "downloading" | "loading" | "warming" | "retrying";

export const MODEL_LABEL = "Whisper Base (int8)";
export const MODEL_MB_ESTIMATE = 80; // 23 MB encoder + 54 MB decoder + 3 MB runtime

const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
]);

/**
 * Can this browser run the model at all? Only hard blockers count: Speak always shows, and a failure
 * is explained after the tap. No isolation, threads, GPU or memory hints are required (1 thread is fine).
 */
export function voiceSupport(): { ok: boolean; reason?: string } {
  if (typeof window === "undefined") return { ok: false, reason: "server" };
  if (typeof Worker === "undefined") return { ok: false, reason: "no Web Workers" };
  if (typeof WebAssembly === "undefined") return { ok: false, reason: "no WebAssembly" };
  try {
    if (!WebAssembly.validate(SIMD_PROBE)) return { ok: false, reason: "no WebAssembly SIMD" };
  } catch {
    return { ok: false, reason: "no WebAssembly SIMD" };
  }
  return { ok: true };
}

function resampleTo16k(input: Float32Array, rate: number): Float32Array {
  if (rate === 16000) return input;
  const ratio = rate / 16000;
  const out = new Float32Array(Math.floor(input.length / ratio));
  if (ratio > 1) {
    // Downsample: average each window (a cheap low-pass, good enough for speech).
    for (let i = 0; i < out.length; i++) {
      const a = Math.floor(i * ratio), b = Math.min(input.length, Math.floor((i + 1) * ratio));
      let s = 0;
      for (let j = a; j < b; j++) s += input[j];
      out[i] = s / Math.max(1, b - a);
    }
  } else {
    for (let i = 0; i < out.length; i++) {
      const x = i * ratio, j = Math.floor(x), f = x - j;
      out[i] = input[j] * (1 - f) + (input[j + 1] ?? input[j]) * f;
    }
  }
  return out;
}

type Handlers = {
  onProgress?: (loaded: number, total: number, files: number, done: number) => void;
  onStatus?: (stage: LoadStage, device: string, error?: string) => void;
  onLevel?: (level: number) => void;
  onText?: (text: string) => void;
  onPending?: (n: number) => void;
  /** True while the person is mid-phrase (voice heard and not yet sent). */
  onSpeaking?: (speaking: boolean) => void;
  onChunk?: (stat: ChunkStat) => void;
  onError?: (message: string) => void;
};

const DRAIN_LIMIT_MS = 120_000;
const PAUSE_SEC = 0.5;
const MAX_CHUNK_SEC = 12;

/** Phones and tablets: fewer threads keep them cool and inside their memory. */
export function isPhone(): boolean {
  if (typeof navigator === "undefined") return false;
  const data = (navigator as unknown as { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (data?.mobile) return true;
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1; // iPadOS says "Macintosh"
}

/** Whether the voice model already sits in this browser (no download needed). */
export async function modelCached(): Promise<boolean> {
  try {
    if (typeof caches === "undefined") return false;
    const keys = await (await caches.open("transformers-cache")).keys();
    return ["encoder_model_quantized.onnx", "decoder_model_merged_quantized.onnx"].every((name) => keys.some((key) => key.url.includes(name)));
  } catch {
    return false;
  }
}

export class VoiceEngine {
  private worker: Worker | null = null;
  private ready: Promise<ModelInfo> | null = null;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private nodes: AudioNode[] = [];
  private pending = new Set<number>();
  private nextId = 1;
  private drainWaiters: (() => void)[] = [];
  info: ModelInfo | null = null;
  language = "en";
  device: string | undefined;
  threads: number | undefined;
  /** Loudest block heard this session (0..1 RMS) and how many chunks were sent. */
  maxRms = 0;
  sent = 0;
  /** Why the GPU was given up on (empty when it never was tried or worked). */
  fellBack = "";
  private copies = new Map<number, { audio: Float32Array; language: string; speech: boolean }>(); // GPU chunks, kept for a CPU redo.

  // Pause-splitting state (native sample rate).
  private rate = 48000;
  private noise = 0.003;
  private inChunk = false;
  private chunk: Float32Array[] = [];
  private chunkSec = 0;
  private voicedSec = 0;
  private silence = 0;
  private preroll: Float32Array[] = [];
  private since: Float32Array[] = []; // everything heard since the last chunk was sent (for Stop).
  private sinceSec = 0;
  private sinceMax = 0;

  constructor(private h: Handlers = {}) {}

  setHandlers(h: Handlers) {
    this.h = h;
  }

  private settle(id: number) {
    this.pending.delete(id);
    this.h.onPending?.(this.pending.size);
    if (!this.pending.size) this.drainWaiters.splice(0).forEach((f) => f());
  }

  private failAll(message: string) {
    for (const id of [...this.pending]) {
      this.h.onChunk?.({ seconds: 0, ms: 0, error: message });
      this.settle(id);
    }
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker("/voice/whisper.worker.js", { type: "module" });
    w.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === "progress") this.h.onProgress?.(m.loaded, m.total, m.files, m.done);
      if (m.type === "status") this.h.onStatus?.(m.stage, m.device, m.error);
      if (m.type === "text" && m.gpuFailed) {
        void this.redoOnCpu(m.id, m.gpuFailed);
        return;
      }
      if (m.type === "text") {
        this.copies.delete(m.id);
        if (m.text) this.h.onText?.(m.text);
        if (m.error) this.h.onError?.(`Could not turn that bit into words: ${m.error}`);
        this.h.onChunk?.({ seconds: m.seconds, ms: m.ms, device: m.device, error: m.error, retried: m.retried, empty: !m.text });
        if (m.device && this.info) this.info = { ...this.info, device: m.device };
        this.settle(m.id);
      }
    };
    // A crash inside the worker (out of memory, script failed to load) must never leave the page waiting.
    w.onerror = (ev: ErrorEvent) => {
      ev.preventDefault?.();
      const message = ev.message || "the voice model stopped working";
      this.h.onError?.(message);
      this.failAll(message);
      this.worker?.terminate();
      this.worker = null;
      this.ready = null;
      this.info = null;
    };
    this.worker = w;
    return w;
  }

  /** ONNX Runtime can't switch from GPU to CPU in the same worker: start a fresh CPU worker. */
  private toCpu(reason: string) {
    this.fellBack = reason;
    this.device = "wasm";
    this.h.onError?.(`GPU did not work (${reason}); using the CPU instead`);
    this.h.onStatus?.("retrying", "wasm", `GPU did not work (${reason}); using the CPU instead`);
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.info = null;
  }

  private async redoOnCpu(id: number, reason: string) {
    const c = this.copies.get(id);
    this.copies.clear();
    const pendingCopies = [...this.pending].filter((p) => p !== id);
    this.toCpu(reason);
    try {
      await this.loadModel();
    } catch (err) {
      this.failAll(String((err as Error)?.message || err));
      return;
    }
    // Chunks that were waiting on the dead GPU worker are lost; count them as failed.
    for (const p of pendingCopies) {
      this.h.onChunk?.({ seconds: 0, ms: 0, error: "GPU stopped" });
      this.settle(p);
    }
    if (!c) {
      this.settle(id);
      return;
    }
    this.getWorker().postMessage({ type: "transcribe", id, audio: c.audio, language: c.language, speech: c.speech }, [c.audio.buffer]);
  }

  /** Downloads (first time) or loads from cache, then warms up. Resolves only once the model can run. */
  loadModel(): Promise<ModelInfo> {
    if (this.ready) return this.ready;
    const w = this.getWorker();
    this.ready = new Promise<ModelInfo>((resolve, reject) => {
      const done = () => {
        w.removeEventListener("message", on);
        w.removeEventListener("error", bad);
      };
      const on = (e: MessageEvent) => {
        if (e.data.type === "ready") {
          done();
          const d = e.data;
          this.info = { device: d.device, loadMs: d.loadMs, warmMs: d.warmMs, bytes: d.bytes, threads: d.threads, downloaded: d.downloaded, fellBack: this.fellBack };
          resolve(this.info);
        } else if (e.data.type === "error") {
          done();
          if (e.data.gpu && this.device !== "wasm") {
            this.toCpu(e.data.message);
            this.loadModel().then(resolve, reject);
            return;
          }
          this.ready = null;
          reject(new Error(e.data.message));
        }
      };
      const bad = (ev: ErrorEvent) => {
        done();
        this.ready = null;
        reject(new Error(ev.message || "the voice model could not start"));
      };
      w.addEventListener("message", on);
      w.addEventListener("error", bad);
      w.postMessage({ type: "load", device: this.device, threads: this.threads });
    });
    return this.ready;
  }

  /**
   * Call from the tap handler itself: the AudioContext is created and resumed and the mic is requested
   * before any await, so iOS Safari and Chrome allow audio.
   */
  begin(): { audio: Promise<void> } {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC || !navigator.mediaDevices?.getUserMedia) {
      // No mic access here (very old browser, or a page not opened over https): explained after the tap.
      const missing = Promise.reject(new Error(!AC ? "no Web Audio" : "no microphone access on this page"));
      missing.catch(() => {});
      return { audio: missing };
    }
    const ctx = new AC();
    void ctx.resume();
    this.ctx = ctx;
    const mic = navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const audio = mic.then((stream) => {
      this.stream = stream;
    });
    return { audio };
  }

  /** Start feeding the mic into the splitter (after the model is ready). */
  async record() {
    const ctx = this.ctx, stream = this.stream;
    if (!ctx || !stream) throw new Error("mic not open");
    if (ctx.state !== "running") await ctx.resume().catch(() => {});
    this.rate = ctx.sampleRate;
    this.resetSplitter();
    this.maxRms = 0;
    this.sent = 0;
    const src = ctx.createMediaStreamSource(stream);
    let sink: AudioNode;
    let worklet = false;
    if (ctx.audioWorklet) {
      try {
        await ctx.audioWorklet.addModule("/voice/capture.worklet.js");
        const node = new AudioWorkletNode(ctx, "bbtp-capture");
        node.port.onmessage = (e: MessageEvent<Float32Array>) => this.block(e.data);
        sink = node;
        worklet = true;
      } catch {
        worklet = false;
      }
    }
    if (!worklet) {
      const sp = ctx.createScriptProcessor(2048, 1, 1);
      sp.onaudioprocess = (e) => this.block(new Float32Array(e.inputBuffer.getChannelData(0)));
      sink = sp;
    }
    const mute = ctx.createGain();
    mute.gain.value = 0;
    src.connect(sink!);
    sink!.connect(mute).connect(ctx.destination); // keeps the graph pulling; plays nothing.
    this.nodes = [src, sink!, mute];
  }

  /** Stop the mic, send whatever was said since the last chunk, and resolve when every chunk has become text. */
  async stop(): Promise<void> {
    if (this.inChunk) this.emit(true);
    else if (this.sinceSec > 0.4 && (this.sent === 0 ? this.sinceMax > 0.002 : this.sinceMax > Math.max(0.006, this.noise * 2))) {
      // Quiet speech that never crossed the pause detector: send it anyway.
      this.chunk = this.since;
      this.voicedSec = this.sinceSec;
      this.emit(true);
    }
    this.inChunk = false;
    this.nodes.forEach((n) => n.disconnect());
    this.nodes = [];
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) void ctx.close().catch(() => {});
    this.h.onLevel?.(0);
    if (this.pending.size) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        new Promise<void>((r) => this.drainWaiters.push(r)),
        new Promise<void>((r) => {
          timer = setTimeout(() => {
            this.h.onError?.("Turning speech into words is taking too long on this device.");
            this.failAll("timed out");
            r();
          }, DRAIN_LIMIT_MS);
        }),
      ]);
      clearTimeout(timer);
    }
  }

  /** Close the mic without waiting (e.g. the model failed). */
  abort() {
    this.nodes.forEach((n) => n.disconnect());
    this.nodes = [];
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.ctx) void this.ctx.close().catch(() => {});
    this.ctx = null;
  }

  private resetSplitter() {
    this.inChunk = false;
    this.chunk = [];
    this.chunkSec = 0;
    this.voicedSec = 0;
    this.silence = 0;
    this.preroll = [];
    this.since = [];
    this.sinceSec = 0;
    this.sinceMax = 0;
    this.noise = 0.003;
  }

  private block(b: Float32Array) {
    let s = 0;
    for (let i = 0; i < b.length; i++) s += b[i] * b[i];
    const rms = Math.sqrt(s / b.length);
    const sec = b.length / this.rate;
    if (rms > this.maxRms) this.maxRms = rms;
    this.h.onLevel?.(Math.min(1, rms * 12));
    this.since.push(b);
    this.sinceSec += sec;
    if (rms > this.sinceMax) this.sinceMax = rms;
    while (this.sinceSec > 28 && this.since.length > 1) this.sinceSec -= this.since.shift()!.length / this.rate;
    const thr = Math.max(0.006, this.noise * 3);
    const voiced = rms > thr;
    if (!voiced) this.noise = Math.min(0.05, Math.max(0.0015, this.noise * 0.95 + rms * 0.05));
    if (!this.inChunk) {
      this.preroll.push(b);
      if (this.preroll.length * sec > 0.3) this.preroll.shift();
      if (voiced) {
        this.h.onSpeaking?.(true);
        this.inChunk = true;
        this.chunk = this.preroll.splice(0);
        this.chunkSec = this.chunk.length * sec;
        this.voicedSec = sec;
        this.silence = 0;
      }
      return;
    }
    this.chunk.push(b);
    this.chunkSec += sec;
    if (voiced) {
      this.silence = 0;
      this.voicedSec += sec;
    } else this.silence += sec;
    // A short breath (about half a second) ends a phrase, so words appear while you keep talking.
    if (this.silence >= PAUSE_SEC && this.chunkSec >= 1) {
      this.emit();
      this.inChunk = false;
    } else if (this.silence >= 1.2) {
      this.emit();
      this.inChunk = false;
    } else if (this.chunkSec >= MAX_CHUNK_SEC) {
      this.emit(); // long run without a pause: cut and keep going.
      this.h.onSpeaking?.(true);
    }
  }

  private emit(force = false) {
    this.h.onSpeaking?.(false);
    const parts = this.chunk;
    const voiced = this.voicedSec;
    this.chunk = [];
    this.chunkSec = 0;
    this.voicedSec = 0;
    this.silence = 0;
    this.since = [];
    this.sinceSec = 0;
    this.sinceMax = 0;
    if (!force && voiced < 0.25) return; // a click or a cough: skip (Whisper invents words on near-silence).
    const len = parts.reduce((n, p) => n + p.length, 0);
    if (len / this.rate < 0.2) return;
    const all = new Float32Array(len);
    let o = 0;
    for (const p of parts) {
      all.set(p, o);
      o += p.length;
    }
    const audio = resampleTo16k(all, this.rate);
    const id = this.nextId++;
    this.pending.add(id);
    this.sent++;
    this.h.onPending?.(this.pending.size);
    const speech = voiced >= 0.5;
    if (this.info?.device === "webgpu") this.copies.set(id, { audio: audio.slice(0), language: this.language, speech });
    this.getWorker().postMessage({ type: "transcribe", id, audio, language: this.language, speech }, [audio.buffer]);
  }

  dispose() {
    this.abort();
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
  }
}
