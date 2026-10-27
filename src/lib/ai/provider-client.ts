import type { Turn } from "../book/types";
import { presetFor, type ProviderType } from "./provider-types";
import { roughTokens, type TokenUsage } from "./spend";

/** The fields a call needs. Matches ResolvedProvider from the store. */
export type CallTarget = {
  id?: string;
  label: string;
  type: ProviderType;
  baseUrl: string;
  model: string;
  apiKey: string;
};

export type ChatOut = { content: string; usage: TokenUsage; model: string };

export class ProviderError extends Error {
  status: number;
  constructor(label: string, status: number, detail: string) {
    super(`${label}: ${status ? `HTTP ${status} ` : ""}${detail}`.trim());
    this.status = status;
  }
}

type Fetch = typeof fetch;

function timeoutFor(type: ProviderType, ms?: number) {
  return ms ?? (type === "local" || type === "ollama" ? 600_000 : 180_000);
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const data = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    const message = typeof data.error === "string" ? data.error : data.error?.message ?? data.message;
    if (message) return message.slice(0, 400);
  } catch {
    // not JSON
  }
  return text.slice(0, 400) || response.statusText;
}

function openAiHeaders(target: CallTarget): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (target.apiKey) headers.Authorization = `Bearer ${target.apiKey}`;
  if (target.type === "openrouter") {
    headers["HTTP-Referer"] = "https://bookbythepeople.dev";
    headers["X-Title"] = "Book by the People";
  }
  return headers;
}

/** Chat completion that should return JSON. Falls back through looser request shapes when a host rejects one. */
export async function chatJson(
  target: CallTarget,
  input: { system: string; user: string; schemaName: string; schema: object; maxTokens?: number; timeoutMs?: number; reasoningEffort?: string | null },
  fetcher: Fetch = fetch,
): Promise<ChatOut> {
  const maxTokens = input.maxTokens ?? 8000;
  const signal = AbortSignal.timeout(timeoutFor(target.type, input.timeoutMs));
  if (presetFor(target.type).api === "anthropic") {
    const response = await fetcher(`${target.baseUrl}/messages`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": target.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: target.model,
        max_tokens: maxTokens,
        system: `${input.system}\n\nReply with one JSON object only, no prose, matching this JSON schema:\n${JSON.stringify(input.schema)}`,
        messages: [{ role: "user", content: input.user }],
      }),
    });
    if (!response.ok) throw new ProviderError(target.label, response.status, await readError(response));
    const data = (await response.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } };
    const content = (data.content ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join("").trim();
    if (!content) throw new ProviderError(target.label, 0, "returned an empty reply.");
    return {
      content,
      model: target.model,
      usage: {
        inputTokens: data.usage?.input_tokens ?? roughTokens(input.system + input.user),
        outputTokens: data.usage?.output_tokens ?? roughTokens(content),
        cachedTokens: data.usage?.cache_read_input_tokens ?? 0,
      },
    };
  }

  const strictRole = target.type === "meta" || target.type === "openai";
  const tokenField = strictRole ? "max_completion_tokens" : "max_tokens";
  const base: Record<string, unknown> = {
    model: target.model,
    messages: [
      { role: strictRole ? "developer" : "system", content: `${input.system}\nAnswer with JSON only.` },
      { role: "user", content: input.user },
    ],
    [tokenField]: maxTokens,
  };
  if (input.reasoningEffort && target.type === "meta") base.reasoning_effort = input.reasoningEffort;
  const shapes: Record<string, unknown>[] = [
    { ...base, response_format: { type: "json_schema", json_schema: { name: input.schemaName, schema: input.schema } } },
    { ...base, response_format: { type: "json_object" } },
    { ...base },
  ];
  let lastError: ProviderError | null = null;
  for (const [index, body] of shapes.entries()) {
    const response = await fetcher(`${target.baseUrl}/chat/completions`, {
      method: "POST",
      signal,
      headers: openAiHeaders(target),
      body: JSON.stringify(body),
    });
    if (response.ok) {
      const data = (await response.json()) as {
        choices?: { message?: { content?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
        model?: string;
      };
      const content = data.choices?.[0]?.message?.content?.trim() ?? "";
      if (!content) throw new ProviderError(target.label, 0, "returned an empty reply.");
      return {
        content,
        model: target.model,
        usage: data.usage
          ? {
              inputTokens: data.usage.prompt_tokens ?? 0,
              outputTokens: data.usage.completion_tokens ?? 0,
              cachedTokens: data.usage.prompt_tokens_details?.cached_tokens ?? 0,
            }
          : { inputTokens: roughTokens(input.system + input.user), outputTokens: roughTokens(content), cachedTokens: 0 },
      };
    }
    lastError = new ProviderError(target.label, response.status, await readError(response));
    // Only a "bad request" means the shape was refused; auth and server errors won't improve.
    if (response.status !== 400 && response.status !== 422) throw lastError;
    if (index === shapes.length - 1) break;
    if (/max_completion_tokens|max_tokens/i.test(lastError.message)) {
      for (const shape of shapes) {
        const value = shape[tokenField];
        delete shape[tokenField];
        shape[tokenField === "max_tokens" ? "max_completion_tokens" : "max_tokens"] = value;
      }
    }
    if (/reasoning/i.test(lastError.message)) for (const shape of shapes) delete shape.reasoning_effort;
  }
  throw lastError ?? new ProviderError(target.label, 0, "did not answer.");
}

export type HeardOut = { transcript: string; turns: Turn[]; audioDurationMs: number; model: string };

/** Speech to text. Meta uses /asr/transcribe; the rest use OpenAI-style /audio/transcriptions. */
export async function transcribeWav(
  target: CallTarget & { transcribeModel?: string },
  input: { wav: Buffer; languageName: string; languageCode: string; keywords: string[]; mode?: string },
  fetcher: Fetch = fetch,
): Promise<HeardOut> {
  const preset = presetFor(target.type);
  const model = target.transcribeModel || preset.transcribeModel || target.model;
  const signal = AbortSignal.timeout(180_000);
  if (target.type === "meta") {
    const form = new FormData();
    const request = {
      model,
      audioEncoding: "WAV",
      mode: input.mode ?? "ENDPOINTING",
      languageBias: input.languageName ? [input.languageName] : undefined,
      keywords: input.keywords.filter(Boolean),
    };
    form.append("request", new Blob([JSON.stringify(request)], { type: "application/json" }), "request.json");
    form.append("audio", new Blob([new Uint8Array(input.wav)], { type: "audio/wav" }), "voice.wav");
    const response = await fetcher(`${target.baseUrl}/asr/transcribe`, {
      method: "POST",
      signal,
      headers: { Authorization: `Bearer ${target.apiKey}`, Accept: "application/json" },
      body: form,
    });
    if (!response.ok) throw new ProviderError(target.label, response.status, await readError(response));
    const data = (await response.json()) as { transcript?: string; audioDurationMs?: number; turns?: { turnId: number; startMs: number; endMs: number; transcript: string }[] };
    return {
      transcript: data.transcript ?? "",
      audioDurationMs: data.audioDurationMs ?? 0,
      turns: (data.turns ?? []).map((turn) => ({ turnId: turn.turnId, startMs: turn.startMs, endMs: turn.endMs, transcript: turn.transcript ?? "" })),
      model,
    };
  }
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(input.wav)], { type: "audio/wav" }), "voice.wav");
  form.append("model", model);
  form.append("response_format", "verbose_json");
  if (/^[a-z]{2}$/.test(input.languageCode)) form.append("language", input.languageCode);
  if (input.keywords.length) form.append("prompt", input.keywords.filter(Boolean).join(", ").slice(0, 200));
  const headers: Record<string, string> = {};
  if (target.apiKey) headers.Authorization = `Bearer ${target.apiKey}`;
  const response = await fetcher(`${target.baseUrl}/audio/transcriptions`, { method: "POST", signal, headers, body: form });
  if (!response.ok) throw new ProviderError(target.label, response.status, await readError(response));
  const data = (await response.json()) as { text?: string; duration?: number; segments?: { id?: number; start: number; end: number; text: string }[] };
  return {
    transcript: (data.text ?? "").trim(),
    audioDurationMs: Math.round((data.duration ?? 0) * 1000),
    turns: (data.segments ?? []).map((segment, index) => ({
      turnId: index + 1,
      startMs: Math.round(segment.start * 1000),
      endMs: Math.round(segment.end * 1000),
      transcript: segment.text.trim(),
    })),
    model,
  };
}

/** Tries each provider in order and returns the first success. Errors from all of them are joined. */
export async function firstThatWorks<P extends { label: string }, T>(
  providers: P[],
  call: (provider: P) => Promise<T>,
): Promise<{ result: T; provider: P; skipped: string[] }> {
  const skipped: string[] = [];
  for (const provider of providers) {
    try {
      return { result: await call(provider), provider, skipped };
    } catch (error) {
      skipped.push(error instanceof Error ? error.message : `${provider.label} failed`);
    }
  }
  throw new Error(skipped.length ? `Every AI model failed. ${skipped.join(" · ")}` : "No AI model is set up.");
}

/** A 0.5 s silent 16 kHz mono WAV, used to test speech-to-text without uploading anything personal. */
export function silentWav(ms = 500): Buffer {
  const rate = 16000;
  const samples = Math.round((rate * ms) / 1000);
  const data = samples * 2;
  const buffer = Buffer.alloc(44 + data);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + data, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(data, 40);
  return buffer;
}

/** A minimal real request. Writers answer a tiny JSON prompt; transcription-only models hear half a second of silence. */
export async function testTarget(
  target: CallTarget,
  role: "writer" | "transcription" | "both",
  fetcher: Fetch = fetch,
): Promise<{ ok: boolean; message: string; ms: number }> {
  const started = Date.now();
  try {
    if (role === "transcription") {
      await transcribeWav(target, { wav: silentWav(), languageName: "English", languageCode: "en", keywords: [] }, fetcher);
      return { ok: true, message: `Speech-to-text answered in ${Date.now() - started} ms.`, ms: Date.now() - started };
    }
    const out = await chatJson(
      target,
      {
        system: 'You are a health check. Reply with {"ok":true}.',
        user: "ping",
        schemaName: "ping",
        schema: { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } },
        maxTokens: 400,
        timeoutMs: target.type === "local" || target.type === "ollama" ? 180_000 : 45_000,
      },
      fetcher,
    );
    const ms = Date.now() - started;
    return { ok: true, message: `${out.model} answered in ${ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`}.`, ms };
  } catch (error) {
    const message = error instanceof Error ? (error.name === "TimeoutError" ? `${target.label}: no answer in time.` : error.message) : "Test failed.";
    return { ok: false, message: message.replace(target.apiKey || "\u0000", "••••"), ms: Date.now() - started };
  }
}
