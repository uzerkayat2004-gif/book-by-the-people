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
  // A local model on a CPU can need many minutes for a whole book.
  return ms ?? (type === "local" || type === "ollama" ? 1_800_000 : 180_000);
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as unknown;
    // Gemini wraps its error in a one-item array.
    const data = (Array.isArray(parsed) ? parsed[0] : parsed) as { error?: { message?: string } | string; message?: string };
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

/** Reads an OpenAI-style server-sent event stream into one reply. */
async function readStream(response: Response): Promise<{ content: string; usage: TokenUsage | null }> {
  const text = await response.text();
  let content = "";
  let usage: TokenUsage | null = null;
  for (const line of text.split("\n")) {
    const raw = line.trim();
    if (!raw.startsWith("data:")) continue;
    const payload = raw.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const chunk = JSON.parse(payload) as {
        choices?: { delta?: { content?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } | null;
      };
      content += chunk.choices?.[0]?.delta?.content ?? "";
      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
          cachedTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
        };
      }
    } catch {
      // skip a broken line
    }
  }
  return { content: content.trim(), usage };
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
  // Local models on a CPU can take longer than Node's 5-minute wait for response headers.
  // Streaming sends headers at once, so long local runs don't fail with "fetch failed".
  const stream = target.type === "local" || target.type === "ollama";
  if (stream) for (const shape of shapes) Object.assign(shape, { stream: true, stream_options: { include_usage: true } });
  let lastError: ProviderError | null = null;
  for (const [index, body] of shapes.entries()) {
    const response = await fetcher(`${target.baseUrl}/chat/completions`, {
      method: "POST",
      signal,
      headers: openAiHeaders(target),
      body: JSON.stringify(body),
    });
    if (response.ok && (response.headers.get("content-type") ?? "").includes("text/event-stream")) {
      const { content, usage } = await readStream(response);
      if (!content) throw new ProviderError(target.label, 0, "returned an empty reply.");
      return {
        content,
        model: target.model,
        usage: usage ?? { inputTokens: roughTokens(input.system + input.user), outputTokens: roughTokens(content), cachedTokens: 0 },
      };
    }
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
  input: { wav: Buffer; languageName: string; languageCode: string; keywords: string[]; mode?: string; language?: string; timeoutMs?: number },
  fetcher: Fetch = fetch,
): Promise<HeardOut> {
  const preset = presetFor(target.type);
  const model = target.transcribeModel || preset.transcribeModel || target.model;
  const signal = AbortSignal.timeout(input.timeoutMs ?? 180_000);
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
  if (target.type === "gemini") return transcribeGemini(target, target.transcribeModel ?? "", input, fetcher);
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

/** Gemini language hints (BCP-47) for the page's languages; anything else is auto-detected. */
const GEMINI_LANG: Record<string, string[]> = {
  en: ["en-US", "en-IN", "en-GB"], hinglish: ["hi-IN", "en-IN"], hi: ["hi-IN"], bn: ["bn-IN", "bn-BD"], mr: ["mr-IN"], ta: ["ta-IN"],
  te: ["te-IN"], ur: ["ur-PK"], ne: ["ne-NP"], fr: ["fr-FR"], de: ["de-DE"], es: ["es-US", "es-419"], pt: ["pt-BR", "pt-PT"],
  it: ["it-IT"], nl: ["nl-NL"], pl: ["pl-PL"], ru: ["ru-RU"], uk: ["uk-UA"], tr: ["tr-TR"], ar: ["ar-EG"], fa: ["fa-IR"],
  id: ["id-ID"], ms: ["ms-MY"], tl: ["fil-PH"], vi: ["vi-VN"], th: ["th-TH"], ja: ["ja-JP"], ko: ["ko-KR"], zh: ["cmn-Hans-CN"],
  sv: ["sv-SE"], sw: ["sw-KE"],
};

/** Gemini's speech model, then a fast flash model with no thinking. */
export const GEMINI_HEARERS = ["gemini-3.5-transcribe", "gemini-3.5-flash-lite"];

function geminiText(data: unknown): string {
  const parts = (data as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] }).candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part) => typeof part.text === "string" && !part.thought)
    .map((part) => part.text)
    .join("")
    .trim();
}

/**
 * Gemini: native generateContent with the clip inline as audio/wav. gemini-3.5-transcribe is built for this
 * (verbatim, language hints); a flash model with thinking at "minimal" is the backup. Each try has its own
 * short time limit so one slow call can never hold the page.
 */
async function transcribeGemini(
  target: CallTarget,
  configured: string,
  input: { wav: Buffer; languageName: string; languageCode: string; language?: string; timeoutMs?: number },
  fetcher: Fetch,
): Promise<HeardOut> {
  const root = target.baseUrl.replace(/\/openai\/?$/, "").replace(/\/$/, "");
  const audio = { inlineData: { mimeType: "audio/wav", data: input.wav.toString("base64") } };
  const codes = GEMINI_LANG[input.language ?? input.languageCode] ?? [];
  const language = input.languageName ? ` The speaker talks in ${input.languageName}; write it in that language's usual script.` : "";
  const prompt =
    `Transcribe this audio verbatim.${language} Output only the spoken words, with normal punctuation. ` +
    "No notes, labels, timestamps, quotes or translation. If nobody speaks, output nothing.";
  const models = [...GEMINI_HEARERS, ...(configured && !GEMINI_HEARERS.includes(configured) ? [configured] : [])];
  const errors: string[] = [];
  for (const model of models) {
    const body =
      model.includes("transcribe")
        ? { contents: [{ role: "user", parts: [audio] }], generationConfig: { audioTranscriptionConfig: { languageCodes: codes, mode: "VERBATIM" } } }
        : {
            contents: [{ role: "user", parts: [{ text: prompt }, audio] }],
            generationConfig: {
              temperature: 0,
              ...(/3\.(5|6)|3-flash/.test(model) ? { thinkingConfig: { thinkingLevel: "minimal" } } : /gemini-3|gemini-4/.test(model) ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
            },
          };
    try {
      const response = await fetcher(`${root}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        signal: AbortSignal.timeout(input.timeoutMs ?? 120_000),
        headers: { "Content-Type": "application/json", "x-goog-api-key": target.apiKey },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        errors.push(`${model}: HTTP ${response.status} ${await readError(response)}`);
        continue;
      }
      const transcript = geminiText(await response.json());
      const ms = Math.round(((input.wav.length - 44) / 2 / 16000) * 1000);
      return { transcript, audioDurationMs: Math.max(0, ms), turns: [], model };
    } catch (error) {
      errors.push(`${model}: ${error instanceof Error && error.name === "TimeoutError" ? "timed out" : error instanceof Error ? error.message : "failed"}`);
    }
  }
  throw new ProviderError(target.label, 0, errors.join(" · "));
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

/** How long a key test may take in total. Long enough for a cold start plus a slow provider, short enough to feel quick. */
export const TEST_TIMEOUT_MS = 20_000;

function isTimeout(error: unknown) {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

const KEY_WORDS = /api[ _-]?key|unauthori[sz]ed|authenticat|invalid[_ ]?(x-)?(api[_ ]?)?key|permission|credential/i;
const MODEL_WORDS = /model.{0,40}(not found|not exist|does not exist|unknown|not supported|unavailable|invalid)|(unknown|invalid|no such) model|model_not_found/i;

/** Turns any test failure into one short, plain sentence: key, model, credit, timeout, network or server. */
export function explainTestError(target: CallTarget, error: unknown): string {
  const who = target.label;
  if (isTimeout(error)) return `${who}: no answer in ${TEST_TIMEOUT_MS / 1000} s. The service may be busy. Try again in a minute.`;
  if (error instanceof ProviderError) {
    const { status } = error;
    const text = error.message;
    if (status === 401 || status === 403 || (status === 400 && KEY_WORDS.test(text) && !MODEL_WORDS.test(text))) {
      return `${who}: key rejected. Check you pasted the whole key and that it is your ${who} key.`;
    }
    if (status === 404 || MODEL_WORDS.test(text)) return `${who}: model "${target.model}" not found. Pick another model from the list.`;
    if (status === 402 || /credit|billing|quota|insufficient/i.test(text)) return `${who}: the key works but the account has no credit or quota left.`;
    if (status === 429) return `${who}: too many requests right now. Wait a minute and test again.`;
    if (status >= 500) return `${who}: the service had a problem (HTTP ${status}). Try again later.`;
    return text;
  }
  if (error instanceof TypeError || (error instanceof Error && /fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|certificate/i.test(error.message))) {
    let host = target.baseUrl;
    try {
      host = new URL(target.baseUrl).host;
    } catch {
      // keep the raw text
    }
    return `${who}: could not reach ${host}. Check the base URL.`;
  }
  return error instanceof Error ? error.message : "Test failed.";
}

function maskKey(text: string, key: string) {
  return key ? text.split(key).join("••••") : text;
}

/** The cheapest call that proves the key: a models list (OpenRouter's list is public, so it has /key). */
function keyCheckUrl(target: CallTarget) {
  if (target.type === "openrouter") return `${target.baseUrl}/key`;
  if (presetFor(target.type).api === "anthropic") return `${target.baseUrl}/models?limit=1`;
  return `${target.baseUrl}/models`;
}

function authHeaders(target: CallTarget): Record<string, string> {
  if (presetFor(target.type).api === "anthropic") return { "x-api-key": target.apiKey, "anthropic-version": "2023-06-01" };
  const headers = openAiHeaders(target);
  delete headers["Content-Type"];
  return headers;
}

/** The smallest possible reply: a couple of tokens, no JSON mode, as little thinking as the model allows. */
async function tinyReply(target: CallTarget, signal: AbortSignal, fetcher: Fetch) {
  if (presetFor(target.type).api === "anthropic") {
    const response = await fetcher(`${target.baseUrl}/messages`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", ...authHeaders(target) },
      body: JSON.stringify({ model: target.model, max_tokens: 1, messages: [{ role: "user", content: "Say OK." }] }),
    });
    if (!response.ok) throw new ProviderError(target.label, response.status, await readError(response));
    return;
  }
  const strictRole = target.type === "meta" || target.type === "openai";
  let tokenField = strictRole ? "max_completion_tokens" : "max_tokens";
  // Gemini 3 thinks hard by default; "minimal" keeps a health check to about a second.
  let effort: string | null = target.type === "gemini" ? "minimal" : null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const body: Record<string, unknown> = { model: target.model, messages: [{ role: "user", content: "Say OK." }], [tokenField]: 16 };
    if (effort) body.reasoning_effort = effort;
    const response = await fetcher(`${target.baseUrl}/chat/completions`, { method: "POST", signal, headers: openAiHeaders(target), body: JSON.stringify(body) });
    if (response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return;
    }
    const error = new ProviderError(target.label, response.status, await readError(response));
    if (response.status !== 400 && response.status !== 422) throw error;
    if (effort && /reasoning|thinking/i.test(error.message)) effort = null;
    else if (/max_completion_tokens|max_tokens/i.test(error.message)) tokenField = tokenField === "max_tokens" ? "max_completion_tokens" : "max_tokens";
    else throw error;
  }
  throw new ProviderError(target.label, 400, "refused the test request.");
}

/**
 * A quick real check of a writer key, at most TEST_TIMEOUT_MS:
 * 1. list models (or OpenRouter's /key), which fails fast on a bad key;
 * 2. a two-token reply from the chosen model, which fails fast on a wrong model.
 * Transcription-only models hear half a second of silence. Local models keep the long, full JSON test.
 */
export async function testTarget(
  target: CallTarget,
  role: "writer" | "transcription" | "both",
  fetcher: Fetch = fetch,
): Promise<{ ok: boolean; message: string; ms: number }> {
  const started = Date.now();
  const took = () => {
    const ms = Date.now() - started;
    return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
  };
  const local = target.type === "local" || target.type === "ollama";
  try {
    if (role === "transcription") {
      await transcribeWav(target, { wav: silentWav(), languageName: "English", languageCode: "en", keywords: [] }, fetcher);
      return { ok: true, message: `Speech-to-text answered in ${took()}.`, ms: Date.now() - started };
    }
    if (local) {
      const out = await chatJson(
        target,
        {
          system: 'You are a health check. Reply with {"ok":true}.',
          user: "ping",
          schemaName: "ping",
          schema: { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } },
          maxTokens: 1500,
          timeoutMs: 180_000,
        },
        fetcher,
      );
      return { ok: true, message: `${out.model} answered in ${took()}.`, ms: Date.now() - started };
    }
    const signal = AbortSignal.timeout(TEST_TIMEOUT_MS);
    const keyCheck = await fetcher(keyCheckUrl(target), { method: "GET", signal, headers: authHeaders(target) });
    const keyStatus = keyCheck.status;
    if (!keyCheck.ok) {
      const detail = await readError(keyCheck);
      // Some hosts have no models list (404/405); then the reply below is the test. Key errors stop here.
      if (keyStatus === 401 || keyStatus === 403 || (keyStatus === 400 && KEY_WORDS.test(detail))) throw new ProviderError(target.label, keyStatus, detail);
    } else {
      await keyCheck.body?.cancel().catch(() => undefined);
    }
    try {
      await tinyReply(target, signal, fetcher);
    } catch (error) {
      if (isTimeout(error) && keyCheck.ok) {
        return { ok: true, message: `Key works. ${target.model} was slow to answer the quick test; books may take longer.`, ms: Date.now() - started };
      }
      throw error;
    }
    return { ok: true, message: `Key works. ${target.model} answered in ${took()}.`, ms: Date.now() - started };
  } catch (error) {
    const message = local && isTimeout(error) ? `${target.label}: no answer in time.` : explainTestError(target, error);
    return { ok: false, message: maskKey(message, target.apiKey), ms: Date.now() - started };
  }
}
