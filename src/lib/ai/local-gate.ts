/**
 * Local models (llama.cpp, Ollama) only make sense on the creator's own computer. A hosted server sets
 * LOCAL_MODELS=off so nobody downloads multi-GB models onto it; creators there add an API key instead.
 */
export function localModelsOff(): boolean {
  return (process.env.LOCAL_MODELS ?? "").trim().toLowerCase() === "off";
}

export const LOCAL_OFF_MESSAGE =
  "Local models run only on your own computer. On this hosted site, add a Meta API key in Book settings → AI for this book.";
