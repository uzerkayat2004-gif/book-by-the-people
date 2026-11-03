/**
 * Speech and mp3 without any installed program: eSpeak NG compiled to WebAssembly and a JavaScript
 * mp3 encoder. This is what runs on serverless hosts (Vercel) and on a laptop with no speech engine,
 * so every released book gets a real narrated audiobook.
 */

type EspeakModule = { FS: { writeFile(path: string, data: string): void; readFile(path: string): Uint8Array } };
type EspeakFactory = (options: { arguments: string[]; preRun?: ((module: EspeakModule) => void)[]; print?: (text: string) => void; printErr?: (text: string) => void }) => Promise<EspeakModule>;

/** Speaks text to a 22 kHz mono WAV with the built-in eSpeak NG. About an hour of speech takes a few seconds. */
export async function wasmSpeakToWav(text: string, options: { voice?: string; speed?: number } = {}): Promise<Buffer> {
  const loaded = (await import("espeak-ng")) as unknown as { default: EspeakFactory };
  let input = text;
  const engine = await loaded.default({
    // The text goes in as a file: long text passed as an argument overflows the WebAssembly stack.
    arguments: ["-v", options.voice || "en-us", "-s", String(options.speed ?? 152), "-w", "out.wav", "-f", "in.txt"],
    preRun: [
      (instance) => {
        instance.FS.writeFile("in.txt", input);
        input = "";
      },
    ],
    print: () => undefined,
    printErr: () => undefined,
  });
  const wav = Buffer.from(engine.FS.readFile("out.wav"));
  if (wav.length < 100) throw new Error("The built-in voice made an empty file.");
  return wav;
}

function pcmOf(wav: Buffer): { pcm: Int16Array; rate: number; channels: number } {
  if (wav.toString("ascii", 0, 4) !== "RIFF") throw new Error("Not a WAV file.");
  let offset = 12;
  let rate = 22050;
  let channels = 1;
  let bits = 16;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    let size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt ") {
      channels = wav.readUInt16LE(start + 2) || 1;
      rate = wav.readUInt32LE(start + 4);
      bits = wav.readUInt16LE(start + 14);
    } else if (id === "data") {
      // Some engines stream the WAV and leave the size at 0 or 0xFFFFFFFF.
      if (!size || start + size > wav.length) size = wav.length - start;
      if (bits !== 16) throw new Error("Only 16-bit WAV can be encoded here.");
      const copy = Buffer.from(wav.subarray(start, start + size - (size % 2)));
      return { pcm: new Int16Array(copy.buffer, copy.byteOffset, copy.length / 2), rate, channels };
    }
    offset = start + size + (size % 2);
  }
  throw new Error("The WAV file has no audio.");
}

/** WAV → mp3 (mono, 48 kbps for speech) in plain JavaScript. */
export async function wavToMp3(wav: Buffer, kbps = 48): Promise<Buffer> {
  const { pcm, rate, channels } = pcmOf(wav);
  // Mix stereo down to mono: speech does not need two channels.
  let mono = pcm;
  if (channels > 1) {
    mono = new Int16Array(Math.floor(pcm.length / channels));
    for (let i = 0; i < mono.length; i += 1) {
      let sum = 0;
      for (let c = 0; c < channels; c += 1) sum += pcm[i * channels + c];
      mono[i] = Math.round(sum / channels);
    }
  }
  return pcmToMp3(mono, rate, kbps);
}

/** Mono 16-bit samples → mp3. */
export async function pcmToMp3(mono: Int16Array, rate: number, kbps = 48): Promise<Buffer> {
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const encoder = new Mp3Encoder(1, rate, kbps);
  const parts: Buffer[] = [];
  const block = 1152;
  for (let i = 0; i < mono.length; i += block) {
    const chunk = encoder.encodeBuffer(mono.subarray(i, i + block));
    if (chunk.length) parts.push(Buffer.from(chunk));
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(Buffer.from(tail));
  return Buffer.concat(parts);
}
/**
 * The playing time of an MP3 from its frames (each frame is 1152 samples, or 576 for 16–24 kHz).
 * Joined parts are timed with this, so chapter marks and captions line up with what is heard.
 */
export function mp3DurationMs(mp3: Buffer): number {
  const rates: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  const v1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const v2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  let i = 0;
  // Skip an ID3v2 tag.
  if (mp3.length > 10 && mp3.toString("latin1", 0, 3) === "ID3") {
    i = 10 + ((mp3[6] & 0x7f) << 21) + ((mp3[7] & 0x7f) << 14) + ((mp3[8] & 0x7f) << 7) + (mp3[9] & 0x7f);
  }
  let seconds = 0;
  while (i + 4 <= mp3.length) {
    if (mp3[i] !== 0xff || (mp3[i + 1] & 0xe0) !== 0xe0) {
      i += 1;
      continue;
    }
    const version = (mp3[i + 1] >> 3) & 3;
    const layer = (mp3[i + 1] >> 1) & 3;
    const bitIndex = mp3[i + 2] >> 4;
    const rateIndex = (mp3[i + 2] >> 2) & 3;
    const padding = (mp3[i + 2] >> 1) & 1;
    if (version === 1 || layer !== 1 || bitIndex === 0 || bitIndex === 15 || rateIndex === 3) {
      i += 1;
      continue;
    }
    const rate = rates[version][rateIndex];
    const kbps = (version === 3 ? v1 : v2)[bitIndex];
    const samples = version === 3 ? 1152 : 576;
    const size = Math.floor(((samples / 8) * kbps * 1000) / rate) + padding;
    if (size < 4) break;
    seconds += samples / rate;
    i += size;
  }
  return Math.round(seconds * 1000);
}
