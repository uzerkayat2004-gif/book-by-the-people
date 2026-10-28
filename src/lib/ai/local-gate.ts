/**
 * Local models (llama.cpp, Ollama) only make sense on the creator's own computer. A hosted server sets
 * LOCAL_MODELS=off so nobody downloads multi-GB models onto it; creators there add an API key instead.
 * Vercel is always off: its functions have no disk to keep models on.
 */
export function localModelsOff(): boolean {
  return (process.env.LOCAL_MODELS ?? "").trim().toLowerCase() === "off" || Boolean(process.env.VERCEL);
}

export const LOCAL_OFF_MESSAGE =
  "Local models run only on your own computer. On this hosted site, add a Meta API key in Book settings → AI for this book.";
