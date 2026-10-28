/**
 * Meta open-weight models that download without a Hugging Face token. Shared with the UI.
 * Sizes are the exact GGUF byte counts on Hugging Face (checked October 2026).
 */
export type LocalModel = {
  id: string;
  name: string;
  /** Short tag shown on the card, e.g. "Newest" or "Small". */
  tag: string;
  params: string;
  /** Hugging Face repo and file (GGUF), used by the built-in runtime. */
  repo: string;
  file: string;
  bytes: number;
  /** Same model in the Ollama library ("" when Ollama has no matching build). */
  ollama: string;
  ollamaBytes: number;
  /** RAM the model needs to run comfortably (CPU or GPU). */
  ramGb: number;
  note: string;
  /** Context size for llama-server. */
  ctx: number;
  /** Extra llama-server flags (for example the reasoning level). */
  serverArgs: string[];
  recommended?: boolean;
};

const MUSE_LOW_REASONING = ["--chat-template-kwargs", '{"reasoning_strength":"low"}'];

export const LOCAL_MODELS: LocalModel[] = [
  {
    id: "muse-glimmer-30b",
    name: "Muse Glimmer 30B",
    tag: "Newest",
    params: "30B",
    repo: "meta-models/Muse-Glimmer-30B-GGUF",
    file: "Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf",
    bytes: 16_756_683_904,
    ollama: "muse-glimmer:30b",
    ollamaBytes: 18_000_000_000,
    ramGb: 24,
    note: "Best quality",
    ctx: 16384,
    serverArgs: MUSE_LOW_REASONING,
    recommended: true,
  },
  {
    id: "muse-glimmer-30b-compact",
    name: "Muse Glimmer 30B Compact",
    tag: "Newest",
    params: "30B · 2-bit",
    repo: "unsloth/Muse-Glimmer-30B-GGUF",
    file: "Muse-Glimmer-30B-UD-IQ2_M.gguf",
    bytes: 12_255_421_472,
    ollama: "",
    ollamaBytes: 0,
    ramGb: 16,
    note: "Smaller, slower on CPU",
    ctx: 12288,
    serverArgs: MUSE_LOW_REASONING,
  },
  {
    id: "llama-3.2-3b",
    name: "Llama 3.2 3B",
    tag: "Small",
    params: "3B",
    repo: "bartowski/Llama-3.2-3B-Instruct-GGUF",
    file: "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
    bytes: 2_019_377_696,
    ollama: "llama3.2:3b",
    ollamaBytes: 2_000_000_000,
    ramGb: 4,
    note: "Any 8 GB laptop",
    ctx: 8192,
    serverArgs: [],
  },
  {
    id: "llama-3.2-1b",
    name: "Llama 3.2 1B",
    tag: "Tiny",
    params: "1B",
    repo: "bartowski/Llama-3.2-1B-Instruct-GGUF",
    file: "Llama-3.2-1B-Instruct-Q4_K_M.gguf",
    bytes: 807_694_464,
    ollama: "llama3.2:1b",
    ollamaBytes: 1_300_000_000,
    ramGb: 2,
    note: "Fastest",
    ctx: 8192,
    serverArgs: [],
  },
];

/** Meta open-weight models too big for a PC. Shown honestly, with where to run them. */
export type ServerModel = { name: string; size: string; needs: string; hosts: string };

export const SERVER_MODELS: ServerModel[] = [
  {
    name: "Muse Spark Open",
    size: "816B (42B active)",
    needs: "300 GB+ even at 2-bit",
    hosts: "OpenRouter, Together, Fireworks, Groq",
  },
  {
    name: "Llama 4 Scout",
    size: "109B (17B active)",
    needs: "about 65 GB at 4-bit",
    hosts: "OpenRouter",
  },
];

export function localModelById(id: string): LocalModel | undefined {
  if (!id) return undefined;
  return LOCAL_MODELS.find((model) => model.id === id || (model.ollama !== "" && model.ollama === id));
}

export type LocalJob = {
  modelId: string;
  engine: "builtin" | "ollama";
  phase: "runtime" | "model" | "starting" | "testing" | "done" | "error" | "cancelled";
  received: number;
  total: number;
  message: string;
  startedAt: number;
};

export type LocalStatus = {
  dir: string;
  dirSource: "env" | "auto" | "default";
  freeBytes: number | null;
  platform: string;
  ramGb: number;
  runtime: { installed: boolean; build: string; supported: boolean };
  ollama: { running: boolean; version: string; url: string; models: string[] };
  running: { modelId: string; port: number } | null;
  models: (LocalModel & { installed: boolean; inOllama: boolean; providerId: string | null })[];
  job: LocalJob | null;
};

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

/** Direct download of the model file (GGUF) from Hugging Face. */
export function downloadUrl(model: Pick<LocalModel, "repo" | "file">): string {
  return `https://huggingface.co/${model.repo}/resolve/main/${encodeURIComponent(model.file)}?download=true`;
}
