import "server-only";
import { prisma } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { openKey } from "@/lib/secret-box";
import { scrubSecrets } from "@/lib/scrub";
import { providerStore, prepare } from "@/lib/ai/providers";
import type { ResolvedProvider } from "@/lib/ai/provider-store";
import type { CallTarget } from "@/lib/ai/provider-client";
import type { ProviderType } from "@/lib/ai/provider-types";
import { META_WRITER_RECOMMENDED, META_WRITERS, isMetaWriter, type ModelOption } from "./catalog";
import { mediaMetaOnly } from "./flag";

/**
 * Where the media pipeline's model calls can go: the creator's saved models, the Meta key pasted in this book's
 * settings, or the server's own Meta key. Keys are opened here, on the server, and never leave it.
 */
type Target = { id: string; label: string; type: ProviderType; baseUrl: string; model: string; apiKey: string; providerId?: string; resolved?: ResolvedProvider };

async function targetsFor(bookId: string): Promise<Target[]> {
  const book = await prisma.book.findUnique({ where: { id: bookId }, select: { creatorId: true, aiKeyCipher: true } });
  if (!book) return [];
  const cfg = getConfig();
  const out: Target[] = [];
  const saved = await providerStore.chain(book.creatorId, "writer").catch(() => []);
  for (const provider of saved) {
    out.push({ id: provider.id, label: provider.label, type: provider.type, baseUrl: provider.baseUrl, model: provider.model, apiKey: provider.apiKey, providerId: provider.id, resolved: provider });
  }
  if (book.aiKeyCipher) {
    const apiKey = (() => {
      try {
        return openKey(book.aiKeyCipher);
      } catch {
        return "";
      }
    })();
    if (apiKey) out.push({ id: "book-key", label: "Meta (this book's key)", type: "meta", baseUrl: cfg.metaBaseUrl, model: cfg.writerModel, apiKey });
  }
  if (cfg.aiMode === "live" && cfg.writerApiKey) {
    out.push({ id: "server", label: "Meta (server key)", type: "meta", baseUrl: cfg.writerBaseUrl || cfg.metaBaseUrl, model: cfg.writerModel, apiKey: cfg.writerApiKey });
  }
  return mediaMetaOnly() ? out.filter((t) => t.type === "meta") : out;
}

const modelCache = new Map<string, { at: number; ids: string[] | null }>();

/** The model ids this key's team can use (GET /models), cached for 10 minutes. null = could not ask. */
async function keyModels(target: Target): Promise<string[] | null> {
  const cacheKey = `${target.id}:${target.apiKey.slice(-4)}`;
  const hit = modelCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 600_000) return hit.ids;
  let ids: string[] | null = null;
  try {
    const response = await fetch(`${target.baseUrl.replace(/\/$/, "")}/models`, {
      headers: { Authorization: `Bearer ${target.apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      const data = (await response.json()) as { data?: { id?: string }[] };
      ids = (data.data ?? []).map((m) => m.id ?? "").filter(Boolean);
    }
  } catch {
    ids = null;
  }
  modelCache.set(cacheKey, { at: Date.now(), ids });
  return ids;
}

/** Writer choices for the pickers, Recommended first. */
export async function writerOptions(bookId: string): Promise<ModelOption[]> {
  const targets = await targetsFor(bookId);
  const options: ModelOption[] = [];
  for (const target of targets) {
    if (target.type === "meta") {
      const live = await keyModels(target);
      const ids = live ? Array.from(new Set([...META_WRITERS.filter((m) => live.includes(m)), ...live.filter(isMetaWriter)])) : META_WRITERS;
      for (const model of ids) {
        options.push({
          value: `${target.id}::${model}`,
          targetId: target.id,
          model,
          label: model,
          provider: target.label,
          recommended: false,
          usable: true,
          note: live ? undefined : "Could not check this key's models",
        });
      }
      if (live) {
        for (const model of META_WRITERS.filter((m) => !live.includes(m))) {
          options.push({ value: `${target.id}::${model}`, targetId: target.id, model, label: model, provider: target.label, recommended: false, usable: false, note: "Not on your key" });
        }
      }
    } else {
      options.push({ value: `${target.id}::${target.model}`, targetId: target.id, model: target.model, label: target.model, provider: target.label, recommended: false, usable: true });
    }
  }
  const best = options.find((o) => o.usable && o.model === META_WRITER_RECOMMENDED) ?? options.find((o) => o.usable);
  if (best) best.recommended = true;
  return [...options.filter((o) => o.recommended), ...options.filter((o) => !o.recommended)];
}

/** The call target for a saved pick ("" = Recommended). null = no model can write (the plain script is used). */
export async function writerTarget(bookId: string, pick: string): Promise<(CallTarget & { tag: string }) | null> {
  const targets = await targetsFor(bookId);
  if (!targets.length) return null;
  const [targetId, model] = pick.includes("::") ? pick.split("::") : ["", ""];
  let target = targets.find((t) => t.id === targetId);
  let chosen = model;
  if (!target) {
    const options = await writerOptions(bookId);
    const best = options.find((o) => o.recommended);
    if (!best) return null;
    target = targets.find((t) => t.id === best.targetId)!;
    chosen = best.model;
  }
  const base: CallTarget = { id: target.providerId, label: target.label, type: target.type, baseUrl: target.baseUrl, model: chosen || target.model, apiKey: target.apiKey };
  // Saved providers go through the same address check as every other model call.
  const ready = target.resolved ? { ...(await prepare({ ...target.resolved, model: base.model })), label: target.label } : base;
  return { ...ready, tag: target.type === "meta" ? "meta" : target.type };
}

export function safeError(error: unknown, key?: string): string {
  return scrubSecrets(error instanceof Error ? error.message : String(error ?? "error"), key).slice(0, 300);
}

