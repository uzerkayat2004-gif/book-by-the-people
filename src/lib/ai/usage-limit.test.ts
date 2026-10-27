import { describe, expect, it } from "vitest";
import { compactTokens, limitReached, limitShare, parseUsageLimit, usageLine } from "./spend";
import { pickChain } from "./provider-types";
import { chatJson } from "./provider-client";
import { LOCAL_MODELS, SERVER_MODELS, localModelById } from "./local-catalog";

describe("usage limit", () => {
  it("defaults to no limit and never stops", () => {
    const none = parseUsageLimit("none", "");
    expect(none).toEqual({ kind: "none", value: 0 });
    expect(limitReached({ usd: 9999, tokens: 1e12 }, none)).toBe(false);
    expect(limitShare({ usd: 5, tokens: 5 }, none)).toBeNull();
  });

  it("stops at a dollar limit", () => {
    const limit = parseUsageLimit("usd", "$12.345");
    expect(limit).toEqual({ kind: "usd", value: 12.35 });
    expect(limitReached({ usd: 12.34, tokens: 0 }, limit)).toBe(false);
    expect(limitReached({ usd: 12.35, tokens: 0 }, limit)).toBe(true);
    expect(limitShare({ usd: 6.175, tokens: 0 }, limit)).toBeCloseTo(0.5);
  });

  it("stops at a token limit like 1 billion", () => {
    const limit = parseUsageLimit("tokens", "1,000,000,000");
    expect(limit).toEqual({ kind: "tokens", value: 1e9 });
    expect(limitReached({ usd: 0, tokens: 999_999_999 }, limit)).toBe(false);
    expect(limitReached({ usd: 0, tokens: 1e9 }, limit)).toBe(true);
    expect(usageLine({ usd: 0, tokens: 250_000_000 }, limit)).toBe("250M tokens of 1B");
  });

  it("dollar and token limits ignore the other unit", () => {
    expect(limitReached({ usd: 100, tokens: 10 }, { kind: "tokens", value: 1000 })).toBe(false);
    expect(limitReached({ usd: 1, tokens: 1e12 }, { kind: "usd", value: 5 })).toBe(false);
  });

  it("still honours an operator cap when set", () => {
    expect(limitReached({ usd: 21, tokens: 0 }, { kind: "none", value: 0 }, 20)).toBe(true);
    expect(limitReached({ usd: 21, tokens: 0 }, { kind: "none", value: 0 }, null)).toBe(false);
  });

  it("rejects bad limits", () => {
    expect(() => parseUsageLimit("usd", "0")).toThrow();
    expect(() => parseUsageLimit("tokens", "-5")).toThrow();
    expect(() => parseUsageLimit("tokens", "abc")).toThrow();
    expect(() => parseUsageLimit("euros", 5)).toThrow();
  });

  it("formats token counts", () => {
    expect(compactTokens(950)).toBe("950");
    expect(compactTokens(1500)).toBe("1.5K");
    expect(compactTokens(1_000_000_000)).toBe("1B");
  });
});

describe("one model runs everything", () => {
  it("uses only the picked model unless fallback is on", () => {
    expect(pickChain(["a", "b", "c"], false)).toEqual(["a"]);
    expect(pickChain(["a", "b", "c"], true)).toEqual(["a", "b", "c"]);
    expect(pickChain([], false)).toEqual([]);
  });
});

describe("local catalog", () => {
  it("keeps a small model for 8 GB laptops and lists big ones as server only", () => {
    expect(LOCAL_MODELS.some((model) => model.ramGb <= 8)).toBe(true);
    expect(SERVER_MODELS.length).toBeGreaterThan(0);
    expect(localModelById("")).toBeUndefined();
    for (const model of LOCAL_MODELS) {
      expect(model.file.endsWith(".gguf")).toBe(true);
      expect(model.bytes).toBeGreaterThan(100_000_000);
      expect(localModelById(model.id)).toBe(model);
    }
    expect(localModelById("muse-glimmer:30b")?.id).toBe("muse-glimmer-30b");
  });
});

describe("local streaming", () => {
  it("asks local models to stream and joins the pieces", async () => {
    let sent: Record<string, unknown> = {};
    const body = ['data: {"choices":[{"delta":{"content":"{\\"a\\":"}}]}', 'data: {"choices":[{"delta":{"content":"1}"}}]}', 'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":3}}', "data: [DONE]", ""].join("\n");
    const fake = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch;
    const out = await chatJson({ label: "L", type: "local", baseUrl: "http://x/v1", model: "m", apiKey: "" }, { system: "s", user: "u", schemaName: "x", schema: {} }, fake);
    expect(sent.stream).toBe(true);
    expect(out.content).toBe('{"a":1}');
    expect(out.usage.outputTokens).toBe(3);
  });
});

describe("limit shorthand", () => {
  it("reads K, M and B", () => {
    expect(parseUsageLimit("tokens", "1B")).toEqual({ kind: "tokens", value: 1e9 });
    expect(parseUsageLimit("tokens", "250m")).toEqual({ kind: "tokens", value: 2.5e8 });
    expect(parseUsageLimit("tokens", "1.5k")).toEqual({ kind: "tokens", value: 1500 });
    expect(() => parseUsageLimit("tokens", "lots")).toThrow();
  });
});
