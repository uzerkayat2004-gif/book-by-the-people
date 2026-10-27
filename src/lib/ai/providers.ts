import "server-only";
import { prisma } from "../db";
import { getConfig } from "../config";
import { keyLast4, openKey, sealKey } from "../secret-box";
import { chatJson, firstThatWorks, testTarget, transcribeWav, type CallTarget, type ChatOut, type HeardOut } from "./provider-client";
import { createProviderStore, type ProviderDb, type ResolvedProvider } from "./provider-store";
import { isLocalType, presetFor } from "./provider-types";
import { ensureServer, LOCAL_PORT } from "./local-runtime";

export const providerStore = createProviderStore(prisma.aiProvider as unknown as ProviderDb, {
  seal: sealKey,
  open: openKey,
  last4: keyLast4,
});

async function creatorOf(bookId: string | null | undefined): Promise<string | null> {
  if (!bookId) return null;
  const book = await prisma.book.findUnique({ where: { id: bookId }, select: { creatorId: true } });
  return book?.creatorId ?? null;
}

export async function writerChain(bookId: string | null | undefined): Promise<ResolvedProvider[]> {
  const userId = await creatorOf(bookId);
  return userId ? providerStore.chain(userId, "writer") : [];
}

export async function transcriberChain(bookId: string | null | undefined): Promise<ResolvedProvider[]> {
  const userId = await creatorOf(bookId);
  return userId ? providerStore.chain(userId, "transcription") : [];
}

/** True when this book's AI calls go to a real model: the creator added one, or the server runs live. */
export async function writerLive(bookId: string | null | undefined): Promise<boolean> {
  if (getConfig().aiMode === "live") return true;
  return (await writerChain(bookId)).length > 0;
}

export async function transcriberLive(bookId: string | null | undefined): Promise<boolean> {
  if (getConfig().aiMode === "live") return true;
  return (await transcriberChain(bookId)).length > 0;
}

/** Local providers start their runtime on first use (built-in llama.cpp) and always use the managed port. */
export async function prepare(provider: ResolvedProvider): Promise<CallTarget & { transcribeModel?: string }> {
  if (provider.type === "local") {
    await ensureServer(provider.localModel || provider.model);
    return { ...provider, baseUrl: `http://127.0.0.1:${LOCAL_PORT}/v1` };
  }
  return { ...provider, transcribeModel: provider.role === "transcription" ? provider.model : presetFor(provider.type).transcribeModel };
}

/** Name stored on usage rows and drafts. "local" rows cost nothing. */
export function providerTag(provider: { type: string }): string {
  return isLocalType(provider.type) ? "local" : provider.type;
}

export async function chatWithProviders(
  chain: ResolvedProvider[],
  input: { system: string; user: string; schemaName: string; schema: object },
): Promise<ChatOut & { provider: string; label: string; skipped: string[] }> {
  const reasoning = getConfig().writerReasoningEffort || null;
  const { result, provider, skipped } = await firstThatWorks(chain, async (item) =>
    chatJson(await prepare(item), { ...input, reasoningEffort: reasoning }),
  );
  return { ...result, provider: providerTag(provider), label: provider.label, skipped };
}

export async function transcribeWithProviders(
  chain: ResolvedProvider[],
  input: { wav: Buffer; languageName: string; languageCode: string; keywords: string[] },
): Promise<HeardOut & { provider: string }> {
  const mode = getConfig().transcribeMode;
  const { result, provider } = await firstThatWorks(chain, async (item) => transcribeWav(await prepare(item), { ...input, mode }));
  return { ...result, provider: providerTag(provider) };
}

export async function testProvider(userId: string, id: string) {
  const provider = await providerStore.resolve(userId, id);
  let outcome: { ok: boolean; message: string; ms: number };
  try {
    const target = await prepare(provider);
    outcome = await testTarget(target, provider.role);
  } catch (error) {
    outcome = { ok: false, message: error instanceof Error ? error.message : "Test failed.", ms: 0 };
  }
  await providerStore.recordTest(provider.id, outcome.ok, outcome.message);
  return outcome;
}

/** A short summary for the Studio: which model writes and which one hears. */
export async function aiSummary(userId: string) {
  const [writers, hearers] = await Promise.all([providerStore.chain(userId, "writer"), providerStore.chain(userId, "transcription")]);
  const cfg = getConfig();
  const envLive = cfg.aiMode === "live";
  return {
    writer: writers[0] ? `${writers[0].label}` : envLive ? `${cfg.writerModel} (server key)` : null,
    hearer: hearers[0] ? `${hearers[0].label}` : envLive ? `${cfg.transcribeModel} (server key)` : null,
    fallbacks: Math.max(0, writers.length - 1),
  };
}
