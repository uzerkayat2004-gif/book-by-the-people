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

export type UsageLimitKind = "none" | "usd" | "tokens";
export type UsageLimit = { kind: UsageLimitKind; value: number };
export type UsageTotals = { usd: number; tokens: number };

export const MAX_TOKEN_LIMIT = 1e15;

/** Validates a limit from the settings form. Anything empty or zero-ish with kind none means no limit. */
/** "1B", "250m", "1.5k", "$20", "1,000,000" → a number. NaN when unreadable. */
function parseAmount(text: string): number {
  const match = /^(\d+(?:\.\d+)?)([kmb])?$/i.exec(text.replace(/[,_\s$]/g, ""));
  if (!match) return Number.NaN;
  const scale = { k: 1e3, m: 1e6, b: 1e9 }[(match[2] ?? "").toLowerCase() as "k" | "m" | "b"] ?? 1;
  return Number(match[1]) * scale;
}

export function parseUsageLimit(kind: string, value: unknown): UsageLimit {
  if (kind === "none") return { kind: "none", value: 0 };
  if (kind !== "usd" && kind !== "tokens") throw new Error("Pick no limit, dollars, or tokens.");
  const number = typeof value === "string" ? parseAmount(value) : Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error("Enter a limit above zero.");
  if (kind === "usd") {
    if (number > 1e7) throw new Error("That dollar limit is too large.");
    return { kind, value: Math.round(number * 100) / 100 };
  }
  if (number > MAX_TOKEN_LIMIT) throw new Error("That token limit is too large.");
  return { kind, value: Math.round(number) };
}

/** Tokens count input (including cached) plus output, as logged per call. */
export function usedTokens(row: { inputTokens: number; outputTokens: number }): number {
  return Math.max(0, row.inputTokens) + Math.max(0, row.outputTokens);
}

/** True when the book's own limit, or the optional server cap, is used up. */
export function limitReached(totals: UsageTotals, limit: UsageLimit, serverCapUsd: number | null = null): boolean {
  if (voicesPaused(totals.usd, serverCapUsd)) return true;
  if (limit.kind === "usd") return totals.usd >= limit.value;
  if (limit.kind === "tokens") return totals.tokens >= limit.value;
  return false;
}

/** 0..1 share of the limit used, or null with no limit. */
export function limitShare(totals: UsageTotals, limit: UsageLimit): number | null {
  if (limit.kind === "none" || limit.value <= 0) return null;
  const used = limit.kind === "usd" ? totals.usd : totals.tokens;
  return Math.min(1, used / limit.value);
}

export function compactTokens(value: number): string {
  if (value >= 1e9) return `${+(value / 1e9).toFixed(value >= 1e10 ? 0 : 1)}B`;
  if (value >= 1e6) return `${+(value / 1e6).toFixed(value >= 1e7 ? 0 : 1)}M`;
  if (value >= 1e3) return `${+(value / 1e3).toFixed(value >= 1e4 ? 0 : 1)}K`;
  return String(Math.round(value));
}

export function usageLine(totals: UsageTotals, limit: UsageLimit): string {
  const usd = totals.usd > 0 && totals.usd < 0.01 ? "<$0.01" : `$${totals.usd.toFixed(2)}`;
  const tokens = `${compactTokens(totals.tokens)} tokens`;
  if (limit.kind === "usd") return `${usd} of $${limit.value.toFixed(2)}`;
  if (limit.kind === "tokens") return `${tokens} of ${compactTokens(limit.value)}`;
  return `${usd} · ${tokens}`;
}
