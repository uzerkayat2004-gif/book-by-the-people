import "server-only";
import { prisma } from "../db";
import { getConfig } from "../config";
import { estimateTokensUsd, estimateTranscribeUsd, voicesPaused, type TokenUsage } from "../ai/spend";

export async function totalSpendUsd(): Promise<number> {
  const sum = await prisma.aiUsage.aggregate({ _sum: { estimatedUsd: true } });
  return sum._sum.estimatedUsd ?? 0;
}

export async function bookSpendUsd(bookId: string): Promise<number> {
  const sum = await prisma.aiUsage.aggregate({ where: { bookId }, _sum: { estimatedUsd: true } });
  return sum._sum.estimatedUsd ?? 0;
}

/** One total cap per book. Unset means that book is not capped. There is no daily cap. */
export async function bookSpendPaused(bookId: string): Promise<boolean> {
  return voicesPaused(await bookSpendUsd(bookId), getConfig().spendCapUsd);
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
      estimatedUsd: audioUsd + tokenUsd,
    },
  });
}
