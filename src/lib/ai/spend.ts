import type { Prices } from "../config";

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
};

/** Muse Voice Transcribe bills whole seconds, rounded down. $0.18 per hour on the standard rate. */
export function estimateTranscribeUsd(audioMs: number, rates: Prices): number {
  const seconds = Math.max(0, Math.floor(audioMs / 1000));
  return (seconds / 3600) * rates.transcribePerHour;
}

/** Standard Muse Spark rates: input $1.25, cached input $0.15, output $4.25 per million tokens. */
export function estimateTokensUsd(usage: TokenUsage, rates: Prices): number {
  const cached = Math.min(Math.max(0, usage.cachedTokens), Math.max(0, usage.inputTokens));
  const fresh = Math.max(0, usage.inputTokens - cached);
  return (
    (fresh / 1_000_000) * rates.inputPerMtok +
    (cached / 1_000_000) * rates.cachedInputPerMtok +
    (Math.max(0, usage.outputTokens) / 1_000_000) * rates.outputPerMtok
  );
}

export function voicesPaused(spentUsd: number, capUsd: number | null): boolean {
  if (capUsd === null || !Number.isFinite(capUsd)) return false;
  return spentUsd >= capUsd;
}

export function roughTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
