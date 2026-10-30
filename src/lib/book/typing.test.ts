import { describe, expect, it } from "vitest";
import { inputSignal } from "./typing";

const words = "My first job at a tea stall taught me to listen before I spoke, and that patience pays rent.";

describe("inputSignal", () => {
  it("passes honest typing", () => {
    expect(inputSignal("write", words, { activeMs: 40_000, keys: words.length + 6, spoken: 0 }).fast).toBe(false);
  });
  it("passes honest dictation", () => {
    expect(inputSignal("speak", words, { activeMs: 9_000, keys: 3, spoken: words.length }).fast).toBe(false);
  });
  it("flags words that were never typed or spoken", () => {
    const signal = inputSignal("write", words, { activeMs: 2_000, keys: 4, spoken: 0 });
    expect(signal.fast).toBe(true);
  });
  it("flags impossible typing speed", () => {
    expect(inputSignal("write", words, { activeMs: 1_500, keys: words.length, spoken: 0 }).why).toMatch(/fast/);
  });
  it("never flags short answers", () => {
    expect(inputSignal("write", "Be kind.", { activeMs: 10, keys: 0 }).fast).toBe(false);
  });
});
