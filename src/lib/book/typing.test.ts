import { describe, expect, it } from "vitest";
import { inputSignal } from "./typing";

const words = "My first job at a tea stall taught me to listen before I spoke, and that patience pays rent.";

describe("inputSignal", () => {
  it("records typing as it was given", () => {
    expect(inputSignal("write", words, { activeMs: 40_000, keys: words.length + 6, spoken: 0 })).toEqual({
      mode: "write",
      activeMs: 40_000,
      keys: words.length + 6,
      chars: words.length,
      spoken: 0,
    });
  });
  it("never flags a pasted answer: no keys, no time, nothing held back", () => {
    const signal = inputSignal("write", words, { activeMs: 0, keys: 0, spoken: 0 });
    expect(signal).not.toHaveProperty("fast");
    expect(signal).not.toHaveProperty("why");
    expect(signal.chars).toBe(words.length);
  });
  it("cleans bad numbers", () => {
    expect(inputSignal("speak", "Be kind.", { activeMs: -5, keys: Number.NaN })).toMatchObject({ activeMs: 0, keys: 0, spoken: 0 });
  });
});
