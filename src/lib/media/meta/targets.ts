import "server-only";
import { prisma } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { openKey } from "@/lib/secret-box";
import { scrubSecrets } from "@/lib/scrub";
import { providerStore, prepare } from "@/lib/ai/providers";
import type { ResolvedProvider } from "@/lib/ai/provider-store";
import { ProviderError, type CallTarget } from "@/lib/ai/provider-client";
import type { ProviderType } from "@/lib/ai/provider-types";
import { META_IMAGE_MODELS, META_WRITER_RECOMMENDED, META_WRITERS, isMetaImage, isMetaWriter, type ModelOption } from "./catalog";
import { mediaMetaOnly } from "./flag";

/**
 * Where the media pipeline's model calls can go: the creator's saved models, the Meta key pasted in this book's
 * settings, or the server's own Meta key. Keys are opened here, on the server, and never leave it.
 */
export type Target = { id: string; label: string; type: ProviderType; baseUrl: string; model: string; apiKey: string; providerId?: string; resolved?: ResolvedProvider };

export async function targetsFor(bookId: string): Promise<Target[]> {
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
export async function keyModels(target: Target): Promise<string[] | null> {
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


/** Picture model choices: Meta's image models on the book's key, and "no pictures" (styled cards), which always works. */
export async function imageOptions(bookId: string): Promise<ModelOption[]> {
  const targets = (await targetsFor(bookId)).filter((t) => t.type === "meta");
  const options: ModelOption[] = [];
  for (const target of targets) {
    const live = await keyModels(target);
    const ids = live ? Array.from(new Set([...META_IMAGE_MODELS.filter((m) => live.includes(m)), ...live.filter(isMetaImage)])) : META_IMAGE_MODELS;
    for (const model of ids) {
      options.push({ value: `${target.id}::${model}`, targetId: target.id, model, label: model, provider: target.label, recommended: false, usable: true, note: live ? undefined : "Could not check this key's models" });
    }
    if (live) {
      for (const model of META_IMAGE_MODELS.filter((m) => !live.includes(m))) {
        options.push({ value: `${target.id}::${model}`, targetId: target.id, model, label: model, provider: target.label, recommended: false, usable: false, note: "Not on your key" });
      }
    }
  }
  options.push({ value: "none", targetId: "", model: "No pictures (styled cards)", label: "No pictures (styled cards)", provider: "Built in", recommended: false, usable: true });
  const best = options.find((o) => o.usable && o.model === META_IMAGE_MODELS[0]) ?? options.find((o) => o.usable);
  if (best) best.recommended = true;
  return [...options.filter((o) => o.recommended), ...options.filter((o) => !o.recommended)];
}

/** The picture target for a saved pick ("" = Recommended). null = no pictures. */
export async function imageTarget(bookId: string, pick: string): Promise<(CallTarget & { tag: string }) | null> {
  if (pick === "none") return null;
  const options = await imageOptions(bookId);
  const chosen = options.find((o) => o.value === pick && o.usable) ?? options.find((o) => o.recommended);
  if (!chosen || chosen.value === "none") return null;
  const target = (await targetsFor(bookId)).find((t) => t.id === chosen.targetId);
  if (!target) return null;
  return { label: target.label, type: target.type, baseUrl: target.baseUrl, model: chosen.model, apiKey: target.apiKey, tag: "meta" };
}

/** One picture from Meta's images endpoint, as JPEG bytes. */
export async function makePicture(target: CallTarget, prompt: string, timeoutMs: number): Promise<{ bytes: Buffer; mime: string }> {
  const body: Record<string, unknown> = {
    model: target.model,
    prompt: prompt.slice(0, 3800),
    n: 1,
    size: "1792x1024",
    response_format: "b64_json",
    output_format: "jpeg",
    // "high" lets Muse Image refine its picture over several passes: same price, better hands and faces.
    reasoning_strength: "high",
    // No web or image search (no real people or logos pulled in) and no code-drawn charts.
    tool_enablement: { enable_web_search: false, enable_image_search: false, enable_shell: false },
  };
  const send = () =>
    fetch(`${target.baseUrl.replace(/\/$/, "")}/images/generations`, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${target.apiKey}` },
      body: JSON.stringify(body),
    });
  let response = await send();
  if (response.status === 400) {
    // An older model may not know the optional fields: ask again with the basics only.
    const text = await response.text().catch(() => "");
    if (/reasoning_strength|output_format|size|tool_enablement/i.test(text)) {
      delete body.tool_enablement;
      delete body.reasoning_strength;
      delete body.output_format;
      delete body.size;
      response = await send();
    } else {
      throw new ProviderError(target.label, 400, text.slice(0, 300));
    }
  }
  if (!response.ok) throw new ProviderError(target.label, response.status, (await response.text().catch(() => "")).slice(0, 300));
  const data = (await response.json()) as { data?: { b64_json?: string; url?: string }[]; output_format?: string };
  const first = data.data?.[0];
  let bytes: Buffer | null = null;
  if (first?.b64_json) bytes = Buffer.from(first.b64_json, "base64");
  else if (first?.url && /^https:\/\//.test(first.url)) {
    const image = await fetch(first.url, { signal: AbortSignal.timeout(30_000) });
    if (image.ok) bytes = Buffer.from(await image.arrayBuffer());
  }
  if (!bytes || bytes.length < 500) throw new ProviderError(target.label, 0, "returned no picture.");
  const mime = bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg" : bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png" : bytes.toString("latin1", 8, 12) === "WEBP" ? "image/webp" : "";
  if (!mime) throw new ProviderError(target.label, 0, "returned a file that is not a picture.");
  return { bytes, mime };
}
