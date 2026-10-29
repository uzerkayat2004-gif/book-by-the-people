import { describe, expect, it } from "vitest";
import { chatJson, firstThatWorks, testTarget, type CallTarget } from "./provider-client";

type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> };

function fakeFetch(replies: ((call: Call) => { status: number; json: unknown })[]) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const call = { url, body: init.body ? JSON.parse(String(init.body)) : {}, headers: init.headers as Record<string, string> };
    calls.push(call);
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)](call);
    return new Response(JSON.stringify(reply.json), { status: reply.status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

const ok = { status: 200, json: { choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 5, completion_tokens: 3 } } };
const target = (type: CallTarget["type"], baseUrl = "https://api.example.dev/v1"): CallTarget => ({ label: type, type, baseUrl, model: "m-1", apiKey: "sk-test-12345678" });
const input = { system: "s", user: "u", schemaName: "ping", schema: { type: "object" } };

describe("provider client", () => {
  it("falls back from json_schema to json_object to plain on 400", async () => {
    const { fetcher, calls } = fakeFetch([() => ({ status: 400, json: { error: { message: "response_format json_schema unsupported" } } }), () => ({ status: 400, json: { error: { message: "no" } } }), () => ok]);
    const out = await chatJson(target("groq"), input, fetcher);
    expect(out.content).toBe('{"ok":true}');
    expect(calls.map((call) => (call.body.response_format as { type?: string } | undefined)?.type ?? "none")).toEqual(["json_schema", "json_object", "none"]);
    expect(calls[0].url).toBe("https://api.example.dev/v1/chat/completions");
    expect(calls[0].headers.Authorization).toBe("Bearer sk-test-12345678");
  });

  it("does not retry auth errors", async () => {
    const { fetcher, calls } = fakeFetch([() => ({ status: 401, json: { error: { message: "bad key" } } })]);
    await expect(chatJson(target("openai"), input, fetcher)).rejects.toThrow(/401/);
    expect(calls).toHaveLength(1);
  });

  it("uses the native Anthropic messages API", async () => {
    const { fetcher, calls } = fakeFetch([() => ({ status: 200, json: { content: [{ type: "text", text: '{"ok":true}' }], usage: { input_tokens: 4, output_tokens: 2 } } })]);
    const out = await chatJson(target("anthropic", "https://api.anthropic.com/v1"), input, fetcher);
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0].headers["x-api-key"]).toBe("sk-test-12345678");
    expect(calls[0].body.system).toContain("JSON schema");
    expect(out.usage.inputTokens).toBe(4);
  });

  it("tries the next provider when one fails", async () => {
    const out = await firstThatWorks([{ label: "A" }, { label: "B" }], async (provider) => {
      if (provider.label === "A") throw new Error("A: HTTP 500");
      return provider.label;
    });
    expect(out.result).toBe("B");
    expect(out.skipped).toEqual(["A: HTTP 500"]);
    await expect(firstThatWorks([{ label: "A" }], async () => Promise.reject(new Error("down")))).rejects.toThrow(/Every AI model failed/);
  });

  it("test results never echo the key", async () => {
    const { fetcher } = fakeFetch([() => ({ status: 401, json: { error: { message: "Invalid key sk-test-12345678" } } })]);
    const result = await testTarget(target("openai"), "writer", fetcher);
    expect(result.ok).toBe(false);
    expect(result.message).not.toContain("sk-test-12345678");
  });
});

describe("key test", () => {
  type Seen = { url: string; method: string; body: Record<string, unknown> };
  function scripted(replies: Record<string, { status: number; json: unknown } | "hang" | "offline">) {
    const seen: Seen[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      seen.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : {} });
      const key = Object.keys(replies).find((part) => url.includes(part)) ?? "";
      const reply = replies[key];
      if (reply === "offline") throw new TypeError("fetch failed");
      if (reply === "hang") {
        const error = new Error("The operation was aborted due to timeout");
        error.name = "TimeoutError";
        throw error;
      }
      return new Response(JSON.stringify(reply.json), { status: reply.status, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;
    return { fetcher, seen };
  }
  const gemini: CallTarget = { label: "Gemini", type: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.8-flash", apiKey: "AIza-test-123456" };

  it("says key rejected for Gemini's 400 'valid API key' without trying the model", async () => {
    const { fetcher, seen } = scripted({ "/models": { status: 400, json: [{ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }] } });
    const out = await testTarget(gemini, "writer", fetcher);
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/key rejected/);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ url: "https://generativelanguage.googleapis.com/v1beta/openai/models", method: "GET" });
  });

  it("sends a tiny low-thinking reply for Gemini and passes", async () => {
    const { fetcher, seen } = scripted({ "/models": { status: 200, json: { data: [] } }, "/chat/completions": ok });
    const out = await testTarget(gemini, "writer", fetcher);
    expect(out.ok).toBe(true);
    expect(seen[1].body).toMatchObject({ model: "gemini-3.8-flash", max_tokens: 16, reasoning_effort: "minimal" });
    expect(seen[1].body.response_format).toBeUndefined();
  });

  it("names a wrong model on 404", async () => {
    const { fetcher } = scripted({ "/models": { status: 200, json: { data: [] } }, "/chat/completions": { status: 404, json: { error: { message: "models/x is not found" } } } });
    const out = await testTarget({ ...gemini, model: "gemini-9" }, "writer", fetcher);
    expect(out.message).toMatch(/model "gemini-9" not found/);
  });

  it("separates a timeout from a network error", async () => {
    const slow = await testTarget(gemini, "writer", scripted({ "/models": "hang" }).fetcher);
    expect(slow.message).toMatch(/no answer in 20 s/);
    const down = await testTarget(gemini, "writer", scripted({ "/models": "offline" }).fetcher);
    expect(down.message).toMatch(/could not reach generativelanguage\.googleapis\.com/);
  });

  it("uses /key for OpenRouter, max_completion_tokens for Meta and max_tokens 1 for Anthropic", async () => {
    const router = scripted({ "/key": { status: 401, json: { error: { message: "Missing Authentication header" } } } });
    expect((await testTarget({ ...gemini, label: "OpenRouter", type: "openrouter", baseUrl: "https://openrouter.ai/api/v1" }, "writer", router.fetcher)).message).toMatch(/key rejected/);
    expect(router.seen[0].url).toBe("https://openrouter.ai/api/v1/key");

    const meta = scripted({ "/models": { status: 200, json: { data: [] } }, "/chat/completions": ok });
    await testTarget({ ...gemini, label: "Meta", type: "meta", baseUrl: "https://api.meta.ai/v1", model: "muse-spark-1.3" }, "writer", meta.fetcher);
    expect(meta.seen[0].url).toBe("https://api.meta.ai/v1/models");
    expect(meta.seen[1].body).toMatchObject({ max_completion_tokens: 16 });
    expect(meta.seen[1].body.reasoning_effort).toBeUndefined();

    const claude = scripted({ "/models": { status: 200, json: { data: [] } }, "/messages": { status: 200, json: { content: [] } } });
    expect((await testTarget({ ...gemini, label: "Anthropic", type: "anthropic", baseUrl: "https://api.anthropic.com/v1" }, "writer", claude.fetcher)).ok).toBe(true);
    expect(claude.seen[1].body).toMatchObject({ max_tokens: 1 });
  });

  it("calls a key good but a model slow when only the reply times out", async () => {
    const out = await testTarget(gemini, "writer", scripted({ "/models": { status: 200, json: { data: [] } }, "/chat/completions": "hang" }).fetcher);
    expect(out.ok).toBe(true);
    expect(out.message).toMatch(/slow/);
  });
});
