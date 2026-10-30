/**
 * AI model presets. Shared by the Book settings UI and the server, so it must
 * stay free of server-only imports.
 */
export type ProviderType =
  | "meta"
  | "openai"
  | "gemini"
  | "anthropic"
  | "openrouter"
  | "groq"
  | "fireworks"
  | "together"
  | "ollama"
  | "local"
  | "custom";

export type ProviderRole = "writer" | "transcription" | "both";

export type ProviderPreset = {
  type: ProviderType;
  name: string;
  baseUrl: string;
  model: string;
  /** Speech-to-text model used when the role includes transcription. "" = this type cannot transcribe. */
  transcribeModel: string;
  keyRequired: boolean;
  /** How chat requests are sent. */
  api: "openai" | "anthropic";
  hint: string;
  /** Model ids offered in the picker (first = default). Free text is still allowed. */
  models: string[];
  /** Hidden from the type picker (registered by the app itself). */
  internal?: boolean;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    type: "meta",
    name: "Meta · Muse Spark",
    baseUrl: "https://api.meta.ai/v1",
    model: "muse-spark-1.3",
    transcribeModel: "muse-voice-transcribe-1.0",
    keyRequired: true,
    api: "openai",
    hint: "Muse Spark writes; Muse Voice Transcribe hears.",
    // Newest first (dev.meta.ai/docs/models, checked Oct 28 2026). muse-spark-1.1 is retired from the picks; "Other model…" still takes it.
    models: ["muse-wonder-1.0", "muse-spark-1.3", "muse-spark-1.3-contributor", "muse-spark-1.2", "muse-spark-1.2-contributor"],
  },
  {
    type: "openai",
    name: "OpenAI-compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-6-luna",
    transcribeModel: "whisper-1",
    keyRequired: true,
    api: "openai",
    hint: "OpenAI or any host with /chat/completions.",
    models: ["gpt-6-luna"],
  },
  {
    type: "gemini",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-3.8-flash",
    // Gemini hears audio through chat (input_audio), not a separate speech endpoint.
    transcribeModel: "gemini-3.8-flash",
    keyRequired: true,
    api: "openai",
    hint: "Uses Gemini's OpenAI-compatible endpoint; also transcribes.",
    // Text models from ai.google.dev/gemini-api/docs/models, checked 29 Oct 2026. Stable first, then preview.
    models: ["gemini-3.8-flash", "gemini-4-argon", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.1-pro-preview"],
  },
  {
    type: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-5-5",
    transcribeModel: "",
    keyRequired: true,
    api: "anthropic",
    hint: "Native Messages API.",
    models: ["claude-sonnet-5-5"],
  },
  {
    type: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "meta/muse-spark-open",
    transcribeModel: "",
    keyRequired: true,
    api: "openai",
    hint: "One key: Muse Spark Open, Llama 4 and more.",
    models: ["meta/muse-spark-open", "meta/muse-wonder", "meta/muse-spark-1.3", "meta/muse-glimmer-30b", "meta-llama/llama-4-maverick", "meta-llama/llama-4-scout"],
  },
  {
    type: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    transcribeModel: "whisper-large-v3-turbo",
    keyRequired: true,
    api: "openai",
    hint: "Fast; also transcribes.",
    models: ["llama-3.3-70b-versatile", "meta-models/muse-spark-open"],
  },
  {
    type: "fireworks",
    name: "Fireworks",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    model: "accounts/fireworks/models/muse-spark-open",
    transcribeModel: "",
    keyRequired: true,
    api: "openai",
    hint: "Muse Spark Open, hosted.",
    models: ["accounts/fireworks/models/muse-spark-open", "accounts/fireworks/models/llama-v3p3-70b-instruct"],
  },
  {
    type: "together",
    name: "Together",
    baseUrl: "https://api.together.xyz/v1",
    model: "meta-models/Muse-Spark-Open-816B-A42B",
    transcribeModel: "openai/whisper-large-v3",
    keyRequired: true,
    api: "openai",
    hint: "Muse Spark Open; also transcribes.",
    models: ["meta-models/Muse-Spark-Open-816B-A42B", "meta-llama/Llama-3.3-70B-Instruct-Turbo"],
  },
  {
    type: "ollama",
    name: "Ollama or local server",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "muse-glimmer:30b",
    transcribeModel: "",
    keyRequired: false,
    api: "openai",
    hint: "Ollama, LM Studio, llama.cpp. No key needed.",
    models: ["muse-glimmer:30b", "llama3.2:3b"],
  },
  {
    type: "local",
    name: "Local Meta model",
    baseUrl: "http://127.0.0.1:43180/v1",
    model: "llama-3.2-3b",
    transcribeModel: "",
    keyRequired: false,
    api: "openai",
    hint: "Runs on this computer. Managed under Local models.",
    models: ["llama-3.2-3b"],
    internal: true,
  },
  {
    type: "custom",
    name: "Custom",
    baseUrl: "",
    model: "",
    transcribeModel: "",
    keyRequired: false,
    api: "openai",
    hint: "Any OpenAI-compatible URL.",
    models: [],
  },
];

export const PROVIDER_TYPES = PROVIDER_PRESETS.map((preset) => preset.type);

export function presetFor(type: string): ProviderPreset {
  return PROVIDER_PRESETS.find((preset) => preset.type === type) ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1];
}

export function isProviderType(value: string): value is ProviderType {
  return (PROVIDER_TYPES as string[]).includes(value);
}

export function roleIncludes(role: string, want: "writer" | "transcription"): boolean {
  return role === "both" || role === want;
}

/** Local types never bill. */
export function isLocalType(type: string): boolean {
  return type === "local" || type === "ollama";
}

/** What the browser is allowed to see about a provider. Never the key. */
export type ProviderView = {
  id: string;
  label: string;
  type: ProviderType;
  typeName: string;
  baseUrl: string;
  model: string;
  role: ProviderRole;
  priority: number;
  enabled: boolean;
  hasKey: boolean;
  keyLast4: string;
  localModel: string;
  canTranscribe: boolean;
  lastTestOk: boolean | null;
  lastTestMsg: string;
  lastTestAt: string | null;
};

/** The picked model runs everything. Later models are only tried when the creator turned fallback on. */
export function pickChain<T>(chain: T[], fallback: boolean): T[] {
  return fallback ? chain : chain.slice(0, 1);
}

/** Older local rows were saved as "Name · this computer"; the picker already says where it runs. */
export function shortLabel(label: string): string {
  return label.replace(/\s*·\s*this computer$/i, "");
}

/**
 * Puts the book's chosen model first. A model override applies to writing only;
 * speech keeps the provider's own transcription model.
 */
export function preferBook<T extends { id: string; type: string; model: string; role: string }>(
  chain: T[],
  providerId: string,
  model: string,
  want: "writer" | "transcription",
): T[] {
  if (!providerId) return chain;
  const index = chain.findIndex((item) => item.id === providerId);
  if (index < 0) return chain;
  const picked = chain[index];
  const override = want === "writer" && model.trim() && !isLocalType(picked.type) && picked.role !== "transcription";
  const first = override ? { ...picked, model: model.trim() } : picked;
  return [first, ...chain.slice(0, index), ...chain.slice(index + 1)];
}

/** Model ids to offer for a provider: the preset's list (newest first), with the saved one kept. */
/** A few plain words next to a model id in the pickers. */
const MODEL_NOTES: Record<string, string> = {
  "muse-wonder-1.0": "newest, most capable, costs more",
  "muse-spark-1.3": "recommended",
  "muse-spark-1.3-contributor": "cheaper, may train Meta models",
  "muse-spark-1.2": "previous",
  "muse-spark-1.2-contributor": "previous, cheaper, may train Meta models",
  "meta/muse-spark-open": "open weights",
  "meta/muse-wonder": "newest, most capable",
};

export function modelLabel(id: string): string {
  const note = MODEL_NOTES[id];
  return note ? `${id} · ${note}` : id;
}

export function modelChoices(type: string, current = ""): string[] {
  const list = [...presetFor(type).models];
  if (current && !list.includes(current)) list.unshift(current);
  return list;
}

/** Provider types offered when pasting a new key, Meta first. */
export const NEW_KEY_TYPES: ProviderType[] = ["meta", "openrouter", "together", "fireworks", "groq", "openai", "gemini", "anthropic", "custom"];
