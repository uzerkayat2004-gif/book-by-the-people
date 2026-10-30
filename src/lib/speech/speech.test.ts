import { describe, expect, it } from "vitest";
import { ClipQueue, cleanClipText, dropOverlap, joinPhrase } from "./assemble";
import { Chunker } from "./chunker";
import { Downsampler, encodeWav, toInt16, wavInfo } from "./wav";
import { foldPhrases, sessionText } from "./web-speech";

const RATE = 16000;
const frame = (ms: number, amp: number) => {
  const out = new Float32Array((RATE * ms) / 1000);
  for (let i = 0; i < out.length; i += 1) out[i] = amp * Math.sin((i / RATE) * 2 * Math.PI * 220);
  return out;
};
function feed(chunker: Chunker, pattern: [number, number][]) {
  const clips = [];
  for (const [ms, amp] of pattern) for (let t = 0; t < ms; t += 50) clips.push(...chunker.push(frame(50, amp)));
  return clips;
}

describe("clip queue", () => {
  it("adds clips in spoken order even when they finish out of order", () => {
    const queue = new ClipQueue();
    expect(queue.settle(2, "second")).toEqual([]);
    expect(queue.settle(3, "third")).toEqual([]);
    expect(queue.settle(1, "first")).toEqual(["first", "second", "third"]);
    expect(queue.settle(4, "")).toEqual([]);
    expect(queue.settle(5, "fifth")).toEqual(["fifth"]);
  });
  it("ignores a clip that settles twice", () => {
    const queue = new ClipQueue();
    expect(queue.settle(1, "one")).toEqual(["one"]);
    expect(queue.settle(1, "one")).toEqual([]);
  });
});

describe("joining words", () => {
  it("keeps what the person typed and adds new words at the end", () => {
    expect(joinPhrase("I edited this.", "and then we left")).toBe("I edited this. And then we left");
    expect(joinPhrase("", "hello there")).toBe("Hello there");
  });
  it("drops a repeated clip boundary", () => {
    expect(dropOverlap("we walked to the old market", "the old market was closed")).toBe("was closed");
    expect(dropOverlap("I said no", "no one came")).toBe("no one came");
  });
  it("drops what models say about silence", () => {
    expect(cleanClipText("Thank you.", 400)).toBe("");
    expect(cleanClipText("[BLANK_AUDIO]", 3000)).toBe("");
    expect(cleanClipText("Thank you for the long talk.", 400)).toBe("Thank you for the long talk.");
  });
});

describe("cutting at pauses", () => {
  it("cuts a clip at a pause after speech and drops silence", () => {
    const chunker = new Chunker();
    const clips = feed(chunker, [[1000, 0], [2000, 0.3], [900, 0], [2000, 0], [1500, 0.3]]);
    expect(clips).toHaveLength(1);
    expect(clips[0].seq).toBe(1);
    expect(clips[0].voicedMs).toBeGreaterThanOrEqual(1900);
    // leading silence is trimmed to the pre-roll
    expect(clips[0].ms).toBeLessThan(3400);
    const last = chunker.flush();
    expect(last?.seq).toBe(2);
    expect(chunker.flush()).toBeNull();
  });
  it("always cuts long speech by the max length", () => {
    const chunker = new Chunker({ maxMs: 5000 });
    const clips = feed(chunker, [[12000, 0.3]]);
    expect(clips.length).toBe(2);
    expect(clips.every((clip) => clip.ms <= 5050)).toBe(true);
  });
});

describe("wav", () => {
  it("writes a 16 kHz mono 16-bit WAV the server accepts", () => {
    const down = new Downsampler(48000);
    const samples = down.push(new Float32Array(48000).fill(0.1));
    expect(samples.length).toBe(16000);
    const wav = encodeWav(toInt16(samples));
    expect(wavInfo(wav)).toEqual({ ms: 1000, rate: 16000 });
    expect(wavInfo(new Uint8Array(10))).toBeNull();
  });
});

describe("Android speech results", () => {
  const results = (list: [string, boolean][]) => list.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal }));
  it("folds the cumulative repeats Android sends", () => {
    expect(foldPhrases(["Hey", "hey right", "hey right now", "hey right now AI is taking over"])).toBe("hey right now AI is taking over");
  });
  it("rebuilds the session instead of appending", () => {
    const out = sessionText(results([["Hey right now", true], ["hey right now AI is", true], ["hey right now AI is taking over", false]]));
    expect(out).toEqual({ final: "hey right now AI is", interim: "taking over" });
  });
  it("keeps normal desktop results as separate phrases", () => {
    const out = sessionText(results([["My first job", true], [" taught me to listen", true], [" before I speak", false]]));
    expect(out).toEqual({ final: "My first job taught me to listen", interim: "before I speak" });
  });
});
