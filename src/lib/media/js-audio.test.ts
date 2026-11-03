import { describe, expect, it } from "vitest";
import { mp3DurationMs, pcmToMp3 } from "./js-audio";

describe("mp3DurationMs", () => {
  it("counts the frames of a 16 kHz MP3", async () => {
    const pcm = new Int16Array(16000 * 3).map((_, i) => Math.round(Math.sin(i / 8) * 8000));
    const mp3 = await pcmToMp3(pcm, 16000);
    const ms = mp3DurationMs(mp3);
    // The encoder adds a little padding (whole frames), which is what a player plays too.
    expect(ms).toBeGreaterThanOrEqual(3000);
    expect(ms).toBeLessThanOrEqual(3000 + 3 * 36);
    expect(ms % 36).toBe(0);
  });
  it("is zero for something that is not an MP3", () => {
    expect(mp3DurationMs(Buffer.from("hello world"))).toBe(0);
  });
});
