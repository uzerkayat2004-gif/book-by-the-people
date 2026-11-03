import "server-only";
import { prisma } from "../db";
import { getConfig } from "../config";
import { estimateTokensUsd, estimateTranscribeUsd, limitReached, type TokenUsage, type UsageLimit, type UsageLimitKind, type UsageTotals } from "../ai/spend";

export async function totalSpendUsd(): Promise<number> {
  const sum = await prisma.aiUsage.aggregate({ _sum: { estimatedUsd: true } });
  return sum._sum.estimatedUsd ?? 0;
}

export async function bookSpendUsd(bookId: string): Promise<number> {
  const sum = await prisma.aiUsage.aggregate({ where: { bookId }, _sum: { estimatedUsd: true } });
  return sum._sum.estimatedUsd ?? 0;
}

export async function bookUsage(bookId: string): Promise<UsageTotals> {
  const sum = await prisma.aiUsage.aggregate({ where: { bookId }, _sum: { estimatedUsd: true, inputTokens: true, outputTokens: true } });
  return {
    usd: sum._sum.estimatedUsd ?? 0,
    tokens: Math.max(0, sum._sum.inputTokens ?? 0) + Math.max(0, sum._sum.outputTokens ?? 0),
  };
}

export async function bookLimit(bookId: string): Promise<UsageLimit> {
  const book = await prisma.book.findUnique({ where: { id: bookId }, select: { usageLimitKind: true, usageLimitValue: true } });
  const kind = (book?.usageLimitKind ?? "none") as UsageLimitKind;
  return kind === "usd" || kind === "tokens" ? { kind, value: book?.usageLimitValue ?? 0 } : { kind: "none", value: 0 };
}

/**
 * The book's optional usage limit (dollars or tokens), plus AI_SPEND_CAP_USD when the
 * server operator set one. With neither, AI never stops for spend.
 */
export async function bookSpendPaused(bookId: string): Promise<boolean> {
  const [totals, limit] = await Promise.all([bookUsage(bookId), bookLimit(bookId)]);
  return limitReached(totals, limit, getConfig().spendCapUsd);
}

export async function spendPaused(bookId: string): Promise<boolean> {
  return bookSpendPaused(bookId);
}

export async function recordUsage(input: {
  kind: string;
  provider: string;
  model: string;
  bookId?: string;
  voiceId?: string;
  audioMs?: number;
  usage?: TokenUsage;
  /** A known price for this call (pictures are priced per image, not per token). */
  usd?: number;
}) {
  const prices = getConfig().prices;
  const usage = input.usage ?? { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
  const audioUsd = input.audioMs ? estimateTranscribeUsd(input.audioMs, prices) : 0;
  const tokenUsd = estimateTokensUsd(usage, prices);
  await prisma.aiUsage.create({
    data: {
      kind: input.kind,
      provider: input.provider,
      model: input.model,
      bookId: input.bookId,
      voiceId: input.voiceId,
      audioMs: input.audioMs ?? 0,
      inputTokens: usage.inputTokens,
      cachedTokens: usage.cachedTokens,
      outputTokens: usage.outputTokens,
      // Models on this computer (built-in or Ollama) and demo mode cost nothing.
      estimatedUsd: input.provider === "local" || input.provider === "mock" ? 0 : (input.usd ?? audioUsd + tokenUsd),
    },
  });
}
