import { describe, expect, it } from "vitest";
import { cleanStandfirst } from "./clean-standfirst";

const REAL =
  "Five people imagine handing their inboxes, shopping and daily chaos to Meta's Muse — and discover how much control they would really surrender.";

const LEAKED = `${REAL}

Wait, need ensure formatting? Actually need valid JSON string; standfirst itself should be one sentence; keep internal no extra text. END

Actually output `;

describe("cleanStandfirst", () => {
  it("removes the leaked instruction tail from the live Chapter 1 standfirst", () => {
    expect(cleanStandfirst(LEAKED)).toBe(REAL);
  });

  it("leaves a normal standfirst unchanged", () => {
    expect(cleanStandfirst(REAL)).toBe(REAL);
  });

  it("leaves empty text alone", () => {
    expect(cleanStandfirst("")).toBe("");
  });
});
