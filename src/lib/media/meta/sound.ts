/**
 * Small sound tools for the narration, in plain JS (no ffmpeg on the server):
 * trim each spoken piece, bring it to one loudness, soften its edges, join with crossfades,
 * and an optional soft music bed made from sine tones (made here, so there is nothing to license).
 */

/** Cuts the quiet start and end the voice model leaves, keeping a little air. */
export function trimSilence(audio: Float32Array, rate: number, threshold = 0.012, keepMs = 35): Float32Array {
  let start = 0;
  let end = audio.length - 1;
  while (start < audio.length && Math.abs(audio[start]) < threshold) start += 1;
  while (end > start && Math.abs(audio[end]) < threshold) end -= 1;
  if (start >= end) return new Float32Array(0);
  const keep = Math.round((keepMs / 1000) * rate);
  return audio.slice(Math.max(0, start - keep), Math.min(audio.length, end + keep + 1));
}

/** Loudness of the voiced part only (20 ms frames above a floor), as RMS. */
export function voicedRms(audio: Float32Array, rate: number): number {
  const frame = Math.max(1, Math.round(rate * 0.02));
  let sum = 0;
  let count = 0;
  for (let i = 0; i + frame <= audio.length; i += frame) {
    let local = 0;
    for (let k = i; k < i + frame; k += 1) local += audio[k] * audio[k];
    const rms = Math.sqrt(local / frame);
    if (rms < 0.01) continue;
    sum += local;
    count += frame;
  }
  return count ? Math.sqrt(sum / count) : 0;
}

/** Brings a piece to the target loudness (default about -20 dBFS RMS), with a soft limit on peaks. */
export function level(audio: Float32Array, rate: number, target = 0.1, ceiling = 0.9): Float32Array {
  const rms = voicedRms(audio, rate);
  const gain = rms > 0 ? Math.max(0.25, Math.min(6, target / rms)) : 1;
  const out = new Float32Array(audio.length);
  const knee = ceiling * 0.8;
  for (let i = 0; i < audio.length; i += 1) {
    const x = audio[i] * gain;
    const a = Math.abs(x);
    // Above the knee, peaks are bent smoothly toward the ceiling instead of clipping.
    out[i] = a <= knee ? x : Math.sign(x) * (knee + (ceiling - knee) * Math.tanh((a - knee) / (ceiling - knee)));
  }
  return out;
}

/** Short fades in and out, so no piece starts or stops with a click. */
export function fadeEdges(audio: Float32Array, rate: number, inMs = 12, outMs = 30): Float32Array {
  const fin = Math.min(audio.length, Math.round((inMs / 1000) * rate));
  const fout = Math.min(audio.length, Math.round((outMs / 1000) * rate));
  for (let i = 0; i < fin; i += 1) audio[i] *= i / fin;
  for (let i = 0; i < fout; i += 1) audio[audio.length - 1 - i] *= i / fout;
  return audio;
}

export const toInt16 = (audio: Float32Array) => Int16Array.from(audio, (x) => Math.max(-32768, Math.min(32767, Math.round(x * 32767))));
export const toFloat = (pcm: Int16Array) => Float32Array.from(pcm, (x) => x / 32768);

/** Joins pieces end to start with an equal-power crossfade of `ms` (never a hard cut). */
export function crossfadeJoin(parts: Float32Array[], rate: number, ms = 40): Float32Array {
  const fade = Math.round((ms / 1000) * rate);
  const total = parts.reduce((sum, p, i) => sum + p.length - (i > 0 ? Math.min(fade, p.length, parts[i - 1].length) : 0), 0);
  const out = new Float32Array(Math.max(0, total));
  let at = 0;
  parts.forEach((part, index) => {
    const overlap = index > 0 ? Math.min(fade, part.length, parts[index - 1].length) : 0;
    const start = at - overlap;
    for (let i = 0; i < part.length; i += 1) {
      if (i < overlap) {
        const t = (i + 0.5) / overlap;
        out[start + i] = out[start + i] * Math.cos((t * Math.PI) / 2) + part[i] * Math.sin((t * Math.PI) / 2);
      } else out[start + i] = part[i];
    }
    at = start + part.length;
  });
  return out;
}

/** A soft, slowly breathing chord (A, C sharp, E, G sharp, low A), made from sine waves. */
export function musicPad(seconds: number, rate: number, volume = 0.05): Float32Array {
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  const notes = [110, 220, 277.18, 329.63, 415.3];
  const weights = [0.6, 0.5, 0.35, 0.35, 0.18];
  for (let i = 0; i < n; i += 1) {
    const t = i / rate;
    let v = 0;
    notes.forEach((f, k) => {
      const breathe = 0.75 + 0.25 * Math.sin(2 * Math.PI * (0.07 + k * 0.013) * t + k);
      v += weights[k] * breathe * Math.sin(2 * Math.PI * f * t + k * 0.7);
    });
    out[i] = (v / 2) * volume;
  }
  return out;
}

const env = (i: number, n: number, attack: number, release: number) => Math.min(1, i / Math.max(1, attack), (n - i) / Math.max(1, release));

/**
 * Puts the soft music under the start and end only: it rises alone for `leadMs`, stays quietly under the first
 * words and fades away; at the end it rises after the last word and fades out. Returns the new audio and
 * how much later the narration now starts.
 */
export function withMusicBed(voice: Float32Array, rate: number, opts = { leadMs: 3200, underMs: 4500, tailMs: 6000, volume: 0.05 }): { audio: Float32Array; offsetMs: number } {
  const lead = Math.round((opts.leadMs / 1000) * rate);
  const under = Math.round((opts.underMs / 1000) * rate);
  const tail = Math.round((opts.tailMs / 1000) * rate);
  const out = new Float32Array(lead + voice.length + tail);
  out.set(voice, lead);
  const intro = musicPad((lead + under) / rate, rate, opts.volume);
  for (let i = 0; i < intro.length; i += 1) {
    // Full under the lead, then ducked and fading out under the first words.
    const duck = i < lead ? 1 : 0.45 * (1 - (i - lead) / under);
    out[i] += intro[i] * env(i, intro.length, rate * 1.6, under) * duck;
  }
  const outroLen = Math.round(tail + rate * 1.5);
  const outro = musicPad(outroLen / rate, rate, opts.volume);
  const startAt = out.length - outroLen;
  for (let i = 0; i < outro.length; i += 1) out[startAt + i] += outro[i] * env(i, outro.length, rate * 1.5, rate * 3.5) * (i < rate * 1.5 ? 0.45 : 1);
  return { audio: out, offsetMs: Math.round((lead / rate) * 1000) };
}

/** Writes 16-bit mono PCM as a WAV file. */
export function pcmToWav(pcm: Int16Array, rate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length * 2, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length * 2, 40);
  return Buffer.concat([header, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)]);
}

/** Reads the samples of a 16-bit mono WAV written by pcmToWav. */
export function wavToPcm(wav: Buffer): Int16Array {
  let at = 12;
  while (at + 8 <= wav.length) {
    const id = wav.toString("ascii", at, at + 4);
    const size = wav.readUInt32LE(at + 4);
    if (id === "data") {
      const bytes = wav.subarray(at + 8, at + 8 + size);
      const copy = Buffer.from(bytes);
      return new Int16Array(copy.buffer, copy.byteOffset, Math.floor(copy.length / 2));
    }
    at += 8 + size + (size % 2);
  }
  return new Int16Array(0);
}
