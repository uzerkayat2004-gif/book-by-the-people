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
  /** Hidden from the type picker (registered by the app itself). */
  internal?: boolean;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    type: "meta",
    name: "Meta Model API",
    baseUrl: "https://api.meta.ai/v1",
    model: "muse-spark-1.3",
    transcribeModel: "muse-voice-transcribe-1.0",
    keyRequired: true,
    api: "openai",
    hint: "Muse Spark writes; Muse Voice Transcribe hears.",
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
  },
  {
    type: "gemini",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-3.8-flash",
    transcribeModel: "",
    keyRequired: true,
    api: "openai",
    hint: "Uses Gemini's OpenAI-compatible endpoint.",
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
  },
  {
    type: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "meta-llama/llama-4-maverick",
    transcribeModel: "",
    keyRequired: true,
    api: "openai",
    hint: "One key, many models.",
  },
  {
    type: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    transcribeModel: "whisper-large-v3-turbo",
    keyRequired: true,
    api: "openai",
    hint: "Fast Llama; also transcribes.",
  },
  {
    type: "fireworks",
    name: "Fireworks",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    model: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    transcribeModel: "",
    keyRequired: true,
    api: "openai",
    hint: "Hosted open models.",
  },
  {
    type: "together",
    name: "Together",
    baseUrl: "https://api.together.xyz/v1",
    model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    transcribeModel: "openai/whisper-large-v3",
    keyRequired: true,
    api: "openai",
    hint: "Hosted Llama; also transcribes.",
  },
  {
    type: "ollama",
    name: "Ollama or local server",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "llama3.2:3b",
    transcribeModel: "",
    keyRequired: false,
    api: "openai",
    hint: "Ollama, LM Studio, llama.cpp. No key needed.",
  },
  {
    type: "local",
    name: "Local Meta model",
    baseUrl: "http://127.0.0.1:43180/v1",
    model: "llama-3.2-1b",
    transcribeModel: "",
    keyRequired: false,
    api: "openai",
    hint: "Runs on this computer. Managed under Local models.",
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
