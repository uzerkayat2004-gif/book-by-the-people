/** Meta open models that download without a Hugging Face token. Shared with the UI. */
export type LocalModel = {
  id: string;
  name: string;
  params: string;
  /** Hugging Face repo and file (GGUF, Q4_K_M), used by the built-in runtime. */
  repo: string;
  file: string;
  bytes: number;
  /** Same model in the Ollama library. */
  ollama: string;
  ollamaBytes: number;
  ramGb: number;
  note: string;
  recommended?: boolean;
};

export const LOCAL_MODELS: LocalModel[] = [
  {
    id: "llama-3.2-1b",
    name: "Llama 3.2 1B Instruct",
    params: "1B",
    repo: "bartowski/Llama-3.2-1B-Instruct-GGUF",
    file: "Llama-3.2-1B-Instruct-Q4_K_M.gguf",
    bytes: 807_694_464,
    ollama: "llama3.2:1b",
    ollamaBytes: 1_300_000_000,
    ramGb: 2,
    note: "Fastest. Fine for checks and short books.",
  },
  {
    id: "llama-3.2-3b",
    name: "Llama 3.2 3B Instruct",
    params: "3B",
    repo: "bartowski/Llama-3.2-3B-Instruct-GGUF",
    file: "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
    bytes: 2_019_377_696,
    ollama: "llama3.2:3b",
    ollamaBytes: 2_000_000_000,
    ramGb: 4,
    note: "Best balance on an 8 GB laptop.",
    recommended: true,
  },
  {
    id: "llama-3.1-8b",
    name: "Llama 3.1 8B Instruct",
    params: "8B",
    repo: "bartowski/Meta-Llama-3.1-8B-Instruct-GGUF",
    file: "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
    bytes: 4_920_739_232,
    ollama: "llama3.1:8b",
    ollamaBytes: 4_900_000_000,
    ramGb: 8,
    note: "Best writing. Needs 16 GB RAM.",
  },
];

export function localModelById(id: string): LocalModel | undefined {
  return LOCAL_MODELS.find((model) => model.id === id || model.ollama === id);
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
