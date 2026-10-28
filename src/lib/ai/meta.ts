import "server-only";
import { createHash } from "node:crypto";
import { convertToWavPcm } from "../audio/convert";
import type { Turn } from "../book/types";
import { getConfig } from "../config";
import { bookAiKey, MISSING_KEY } from "./keys";
import { chatWithProviders, transcribeWithProviders, transcriberChain, writerChain } from "./providers";
import { roughTokens, type TokenUsage } from "./spend";

export type ChatResult = {
  content: string;
  provider: string;
  model: string;
  usage: TokenUsage;
};

type ChatTarget = {
  baseUrl: string;
  apiKey: string;
  model: string;
  provider: string;
  reasoningEffort: string | null;
};

function usageFrom(data: { usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } }, fallbackInput: string, fallbackOutput: string): TokenUsage {
  const usage = data.usage;
  if (!usage) {
    return {
      inputTokens: roughTokens(fallbackInput),
      outputTokens: roughTokens(fallbackOutput),
      cachedTokens: 0,
    };
  }
  return {
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
    cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
  };
}

async function postChat(target: ChatTarget, body: Record<string, unknown>): Promise<{ data: ChatPayload; text: string }> {
  const response = await fetch(`${target.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${target.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new ChatError(response.status, text.slice(0, 700), target.provider);
  }
  return { data: JSON.parse(text) as ChatPayload, text };
}

type ChatPayload = {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
};

class ChatError extends Error {
  status: number;
  provider: string;

  constructor(status: number, detail: string, provider: string) {
    super(`${provider} chat failed (${status}): ${detail}`);
    this.status = status;
    this.provider = provider;
  }
}

async function completeOn(target: ChatTarget, input: {
  system: string;
  user: string;
  schemaName: string;
  schema: object;
  safetyId: string;
}): Promise<ChatResult> {
  const messages = [
    { role: "developer", content: input.system },
    { role: "user", content: input.user },
  ];
  const baseBody: Record<string, unknown> = {
    model: target.model,
    messages,
    response_format: {
      type: "json_schema",
      json_schema: { name: input.schemaName, schema: input.schema },
    },
    max_completion_tokens: 8000,
    safety_identifier: input.safetyId,
  };
  if (target.reasoningEffort) baseBody.reasoning_effort = target.reasoningEffort;

  let payload: { data: ChatPayload; text: string };
  try {
    payload = await postChat(target, baseBody);
  } catch (error) {
    if (!(error instanceof ChatError) || error.status !== 400) throw error;
    const detail = error.message.toLowerCase();
    const retry = { ...baseBody };
    let changed = false;
    if (detail.includes("reasoning") && "reasoning_effort" in retry) {
      delete retry.reasoning_effort;
      changed = true;
    }
    if (detail.includes("max_completion_tokens")) {
      delete retry.max_completion_tokens;
      retry.max_tokens = 8000;
      changed = true;
    }
    if (!changed) throw error;
    payload = await postChat(target, retry);
  }

  const content = payload.data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) throw new Error(`${target.provider} returned an empty book.`);
  return {
    content,
    provider: target.provider,
    model: target.model,
    usage: usageFrom(payload.data, input.system + input.user, content),
  };
}

export async function completeJson(input: {
  system: string;
  user: string;
  schemaName: string;
  schema: object;
  bookId: string;
}): Promise<ChatResult> {
  const cfg = getConfig();
  // The creator's own AI models (Book settings → AI models) come first, in their order.
  const chain = await writerChain(input.bookId).catch(() => []);
  let chainError: unknown = null;
  if (chain.length) {
    try {
      const out = await chatWithProviders(chain, input);
      return { content: out.content, provider: out.provider, model: out.model, usage: out.usage };
    } catch (error) {
      chainError = error;
      const bookKey = await bookAiKey(input.bookId).catch(() => "");
      if (!(bookKey && bookKey !== cfg.metaApiKey) && (cfg.aiMode !== "live" || !cfg.writerApiKey)) throw error;
    }
  }
  const ownKey = await bookAiKey(input.bookId).catch(() => "");
  const apiKey = (ownKey && ownKey !== cfg.metaApiKey ? ownKey : "") || cfg.writerApiKey;
  if (!apiKey) throw new Error(MISSING_KEY);
  const safetyId = createHash("sha256").update(input.bookId).digest("hex").slice(0, 32);
  const primary: ChatTarget = {
    baseUrl: cfg.writerBaseUrl,
    apiKey,
    model: cfg.writerModel,
    provider: "meta",
    reasoningEffort: cfg.writerReasoningEffort || null,
  };
  try {
    return await completeOn(primary, { ...input, safetyId });
  } catch (error) {
    if (chainError) {
      const first = chainError instanceof Error ? chainError.message : "Your AI models failed.";
      throw new Error(`${first} The server key also failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
    if (!cfg.fallbackBaseUrl || !cfg.fallbackApiKey) throw error;
    const fallback: ChatTarget = {
      baseUrl: cfg.fallbackBaseUrl,
      apiKey: cfg.fallbackApiKey,
      model: cfg.fallbackModel,
      provider: "openai-compatible",
      reasoningEffort: cfg.writerReasoningEffort || null,
    };
    try {
      return await completeOn(fallback, { ...input, safetyId });
    } catch (fallbackError) {
      const first = error instanceof Error ? error.message : "primary writer failed";
      const second = fallbackError instanceof Error ? fallbackError.message : "fallback writer failed";
      throw new Error(`${first} Fallback also failed: ${second}`);
    }
  }
}

export type TranscriptResult = {
  transcript: string;
  turns: Turn[];
  audioDurationMs: number;
  model: string;
  provider: string;
};

export async function transcribeFile(input: {
  audio: Buffer;
  languageName: string;
  languageCode?: string;
  keywords: string[];
  bookId?: string;
}): Promise<TranscriptResult> {
  const cfg = getConfig();
  const chain = await transcriberChain(input.bookId).catch(() => []);
  if (chain.length) {
    const wav = await convertToWavPcm(input.audio);
    return transcribeWithProviders(chain, {
      wav,
      languageName: input.languageName,
      languageCode: input.languageCode ?? "",
      keywords: input.keywords,
    });
  }
  const apiKey = await bookAiKey(input.bookId);
  if (!apiKey) throw new Error(MISSING_KEY);
  const wav = await convertToWavPcm(input.audio);
  const form = new FormData();
  const request = {
    model: cfg.transcribeModel,
    audioEncoding: "WAV",
    mode: cfg.transcribeMode,
    languageBias: input.languageName ? [input.languageName] : undefined,
    keywords: input.keywords.filter(Boolean),
  };
  form.append("request", new Blob([JSON.stringify(request)], { type: "application/json" }), "request.json");
  form.append("audio", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "voice.wav");

  const response = await fetch(`${cfg.metaBaseUrl}/asr/transcribe`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    body: form,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Muse Voice Transcribe failed (${response.status}): ${text.slice(0, 700)}`);
  }
  const data = JSON.parse(text) as {
    transcript?: string;
    audioDurationMs?: number;
    turns?: { turnId: number; startMs: number; endMs: number; transcript: string }[];
  };
  return {
    transcript: data.transcript ?? "",
    audioDurationMs: data.audioDurationMs ?? 0,
    turns: (data.turns ?? []).map((turn) => ({
      turnId: turn.turnId,
      startMs: turn.startMs,
      endMs: turn.endMs,
      transcript: turn.transcript ?? "",
    })),
    model: cfg.transcribeModel,
    provider: "meta",
  };
}
