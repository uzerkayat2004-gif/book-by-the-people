/**
 * Removes anything that looks like an API key, token or keyed URL from text before it is shown,
 * stored or logged. Provider error bodies sometimes echo part of the key; this keeps them out.
 */
const PATTERNS: RegExp[] = [
  // Google (Gemini) keys
  /AIza[0-9A-Za-z_-]{20,}/g,
  // Meta Llama API keys ("LLM|…") and similar pipe-joined tokens
  /\bLLM\|[^\s"'`,;)]+/g,
  // OpenAI / Anthropic / OpenRouter / Groq / xAI / Together style keys
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}/g,
  /\b(?:sk-ant|sk-or|gsk|xai|nvapi|hf)[-_][A-Za-z0-9_-]{8,}/g,
  // Bearer tokens
  /\bBearer\s+[A-Za-z0-9._~+/|=-]{8,}/gi,
];

/** Keyed query strings such as ?key=…, &api_key=…, ?access_token=… */
const QUERY = /([?&](?:key|api[_-]?key|apikey|access[_-]?token|token|auth)=)[^&\s"'#]+/gi;

export function scrubSecrets(text: string, ...keys: (string | undefined | null)[]): string {
  if (!text) return text;
  let out = text;
  for (const key of keys) {
    const value = (key ?? "").trim();
    if (value.length >= 8) out = out.split(value).join("••••");
  }
  for (const pattern of PATTERNS) out = out.replace(pattern, "••••");
  return out.replace(QUERY, "$1••••");
}
