/** Turns microphone samples into the 16 kHz mono 16-bit WAV every speech model accepts. Browser and server safe. */

export const SPEECH_RATE = 16000;

/** Averages blocks of samples down to 16 kHz. Keeps a fractional position so long recordings never drift. */
export class Downsampler {
  private pos = 0;
  private acc = 0;
  private count = 0;
  constructor(private readonly fromRate: number, private readonly toRate = SPEECH_RATE) {}

  push(input: Float32Array): Float32Array {
    if (this.fromRate === this.toRate) return input.slice();
    const step = this.fromRate / this.toRate;
    const out: number[] = [];
    for (let i = 0; i < input.length; i += 1) {
      this.acc += input[i];
      this.count += 1;
      this.pos += 1;
      if (this.pos >= step) {
        out.push(this.acc / this.count);
        this.pos -= step;
        this.acc = 0;
        this.count = 0;
      }
    }
    return Float32Array.from(out);
  }
}

export function toInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function encodeWav(samples: Int16Array, rate = SPEECH_RATE): Uint8Array {
  const data = samples.length * 2;
  const buffer = new ArrayBuffer(44 + data);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + data, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, data, true);
  new Int16Array(buffer, 44).set(samples);
  return new Uint8Array(buffer);
}

/** Checks a WAV header: RIFF/WAVE, PCM, mono, 16-bit, 16 or 24 kHz. Returns its length in ms, or null when it is not one. */
export function wavInfo(bytes: Uint8Array): { ms: number; rate: number } | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || tag(12) !== "fmt " || tag(36) !== "data") return null;
  const format = view.getUint16(20, true);
  const channels = view.getUint16(22, true);
  const rate = view.getUint32(24, true);
  const bits = view.getUint16(34, true);
  if (format !== 1 || channels !== 1 || bits !== 16 || (rate !== 16000 && rate !== 24000)) return null;
  const data = Math.min(view.getUint32(40, true), bytes.length - 44);
  return { ms: Math.round((data / 2 / rate) * 1000), rate };
}
