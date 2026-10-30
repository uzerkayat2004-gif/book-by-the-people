/**
 * Cuts a live 16 kHz recording into short clips at natural pauses, so each clip can be turned into
 * words while the person keeps talking. A simple energy check finds speech; silence-only clips are dropped.
 */

export type Clip = { seq: number; samples: Float32Array; ms: number; voicedMs: number };

export type ChunkerOptions = {
  rate?: number;
  /** Never cut a clip shorter than this. */
  minMs?: number;
  /** Always cut by this length, pause or not. */
  maxMs?: number;
  /** A pause this long after speech ends a clip. */
  pauseMs?: number;
  /** Silence kept before speech starts, so the first syllable is not lost. */
  prerollMs?: number;
  /** A clip needs this much speech to be sent at all. */
  minVoicedMs?: number;
};

export function rms(frame: Float32Array): number {
  if (!frame.length) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

export class Chunker {
  private readonly rate: number;
  private readonly minMs: number;
  private readonly maxMs: number;
  private readonly pauseMs: number;
  private readonly prerollMs: number;
  private readonly minVoicedMs: number;
  private parts: Float32Array[] = [];
  private length = 0;
  private voicedMs = 0;
  private silentRunMs = 0;
  private seq = 0;
  /** Slowly follows the room's background level. */
  private floor = 0.004;
  level = 0;

  constructor(options: ChunkerOptions = {}) {
    this.rate = options.rate ?? 16000;
    this.minMs = options.minMs ?? 1500;
    this.maxMs = options.maxMs ?? 14000;
    this.pauseMs = options.pauseMs ?? 700;
    this.prerollMs = options.prerollMs ?? 300;
    this.minVoicedMs = options.minVoicedMs ?? 250;
  }

  private ms(samples: number) {
    return (samples / this.rate) * 1000;
  }

  /** True when this frame sounds like speech. */
  isVoiced(frame: Float32Array): boolean {
    const level = rms(frame);
    this.level = level;
    const voiced = level > Math.max(this.floor * 3, 0.012);
    // The floor drops fast to quiet and rises slowly, so speech does not pull it up.
    if (level < this.floor) this.floor = this.floor * 0.7 + level * 0.3;
    else this.floor = voiced ? this.floor * 0.999 + level * 0.001 : this.floor * 0.98 + level * 0.02;
    return voiced;
  }

  /** Feed ~10-100 ms of 16 kHz samples. Returns any clip that is now complete. */
  push(frame: Float32Array): Clip[] {
    const out: Clip[] = [];
    const frameMs = this.ms(frame.length);
    const voiced = this.isVoiced(frame);
    this.parts.push(frame);
    this.length += frame.length;
    if (voiced) {
      this.voicedMs += frameMs;
      this.silentRunMs = 0;
    } else {
      this.silentRunMs += frameMs;
    }
    if (this.voicedMs === 0) {
      // Nothing said yet: keep only a short tail of silence.
      this.trimTo(this.prerollMs);
      return out;
    }
    const total = this.ms(this.length);
    if ((total >= this.minMs && this.silentRunMs >= this.pauseMs) || total >= this.maxMs) {
      const clip = this.cut();
      if (clip) out.push(clip);
    }
    return out;
  }

  /** Ends the recording: returns the last clip if it holds speech. */
  flush(): Clip | null {
    return this.cut();
  }

  private trimTo(ms: number) {
    const keep = Math.round((ms / 1000) * this.rate);
    while (this.parts.length > 1 && this.length - this.parts[0].length >= keep) {
      this.length -= this.parts[0].length;
      this.parts.shift();
    }
  }

  private cut(): Clip | null {
    const voicedMs = this.voicedMs;
    const samples = new Float32Array(this.length);
    let offset = 0;
    for (const part of this.parts) {
      samples.set(part, offset);
      offset += part.length;
    }
    this.parts = [];
    this.length = 0;
    this.voicedMs = 0;
    this.silentRunMs = 0;
    if (voicedMs < this.minVoicedMs) return null;
    this.seq += 1;
    return { seq: this.seq, samples, ms: Math.round(this.ms(samples.length)), voicedMs: Math.round(voicedMs) };
  }
}
