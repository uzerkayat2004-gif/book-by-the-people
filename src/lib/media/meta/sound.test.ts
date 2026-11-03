import { describe, expect, it } from "vitest";
import { crossfadeJoin, level, pcmToWav, toInt16, trimSilence, voicedRms, wavToPcm, withMusicBed } from "./sound";

const tone = (seconds: number, amp: number, rate = 16000) => Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amp * Math.sin((2 * Math.PI * 220 * i) / rate));

describe("narration sound", () => {
  it("trims silence but keeps a little air", () => {
    const audio = new Float32Array(16000 * 2);
    audio.set(tone(0.5, 0.3), 8000);
    const out = trimSilence(audio, 16000);
    expect(out.length).toBeGreaterThan(8000);
    expect(out.length).toBeLessThan(8000 + 0.1 * 16000);
  });

  it("brings quiet and loud pieces to the same loudness", () => {
    const quiet = level(tone(1, 0.03), 16000);
    const loud = level(tone(1, 0.6), 16000);
    expect(Math.abs(voicedRms(quiet, 16000) - voicedRms(loud, 16000))).toBeLessThan(0.01);
    expect(Math.max(...loud.map(Math.abs))).toBeLessThanOrEqual(0.9);
  });

  it("crossfades without a jump at the seam", () => {
    const a = new Float32Array(1000).fill(0.5);
    const b = new Float32Array(1000).fill(-0.5);
    const out = crossfadeJoin([a, b], 16000, 20);
    expect(out.length).toBe(2000 - 320);
    let jump = 0;
    for (let i = 1; i < out.length; i += 1) jump = Math.max(jump, Math.abs(out[i] - out[i - 1]));
    expect(jump).toBeLessThan(0.02);
  });

  it("adds a soft music bed before and after, and says how far the voice moved", () => {
    const voice = tone(5, 0.1);
    const { audio, offsetMs } = withMusicBed(voice, 16000);
    expect(offsetMs).toBe(3200);
    expect(audio.length).toBeGreaterThan(voice.length + 16000 * 8);
    expect(Math.max(...audio.subarray(0, 16000 * 3).map(Math.abs))).toBeLessThan(0.08);
  });

  it("round-trips WAV", () => {
    const pcm = toInt16(tone(0.1, 0.2));
    expect(Array.from(wavToPcm(pcmToWav(pcm, 16000)))).toEqual(Array.from(pcm));
  });
});
