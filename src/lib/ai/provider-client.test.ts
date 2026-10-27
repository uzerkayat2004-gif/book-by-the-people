import { describe, expect, it } from "vitest";
import { chatJson, firstThatWorks, testTarget, type CallTarget } from "./provider-client";

type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> };

function fakeFetch(replies: ((call: Call) => { status: number; json: unknown })[]) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const call = { url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> };
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
