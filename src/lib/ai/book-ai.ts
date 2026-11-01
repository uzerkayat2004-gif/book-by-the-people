import "server-only";
import { prisma } from "../db";
import { getConfig } from "../config";
import { AppError } from "../errors";
import { canStoreKeys, keyLast4, openKey } from "../secret-box";
import { assertPublicModelUrl } from "./net-guard";
import { parseAiChoice, usableProvider, type AiChoice, type AiOptions, type SavedAiOption } from "./book-source";
import { localModelsOff } from "./local-gate";
import { checkProviderInput } from "./provider-store";
import { NEW_KEY_TYPES, isLocalType, shortLabel } from "./provider-types";
import { providerStore } from "./providers";

/** What the create form may offer this creator. Keys never leave the server; only their last 4 characters. */
export async function aiOptions(userId: string): Promise<AiOptions> {
  const localOn = !localModelsOff();
  const providers = (await providerStore.list(userId)).filter((view) => usableProvider(view, localOn));
  const saved: SavedAiOption[] = providers.map((view) => ({
    id: view.id,
    kind: "provider",
    label: shortLabel(view.label),
    detail: isLocalType(view.type) ? "On this computer · free" : view.hasKey ? `Key ••••${view.keyLast4} · saved to your account` : `${view.typeName} · saved to your account`,
    type: view.type,
    model: view.model,
    local: isLocalType(view.type),
  }));
  const books = await prisma.book.findMany({
    where: { creatorId: userId, NOT: { aiKeyCipher: "" } },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, aiKeyCipher: true },
  });
  const seen = new Set(providers.map((view) => view.keyLast4).filter(Boolean));
  for (const book of books) {
    let last4 = "";
    try {
      last4 = keyLast4(openKey(book.aiKeyCipher));
    } catch {
      continue; // Sealed with an older secret; it can't be used.
    }
    if (seen.has(last4)) continue;
    seen.add(last4);
    saved.push({ id: book.id, kind: "book", label: `Meta key ••••${last4}`, detail: `Saved on ${book.title}`, type: "meta", model: getConfig().writerModel, local: false });
  }
  const cfg = getConfig();
  return {
    saved,
    localOn,
    serverKey: Boolean(cfg.metaApiKey),
    demo: process.env.NODE_ENV !== "production" && !process.env.VERCEL && cfg.aiMode === "mock",
  };
}

/** Checks the choice before the book exists, so a bad key never leaves a half-made book. */
export async function checkAiChoice(userId: string, raw: unknown, legacyKey?: string): Promise<AiChoice> {
  let choice: AiChoice;
  try {
    choice = parseAiChoice(raw, legacyKey, await aiOptions(userId));
  } catch (error) {
    throw new AppError(error instanceof Error ? error.message : "Pick your AI.");
  }
  if (choice.source === "new") {
    if (isLocalType(choice.type)) {
      if (localModelsOff()) throw new AppError("Local models run only on your own computer. Add an API key here.");
    } else if (!(NEW_KEY_TYPES as string[]).includes(choice.type)) throw new AppError("Pick a provider.");
    if (!canStoreKeys()) throw new AppError("The server has no AI_KEY_SECRET, so it can't store keys safely yet.", 503);
    await assertPublicModelUrl(checkProviderInput(newProviderBody(choice)).baseUrl);
  }
  return choice;
}

function newProviderBody(choice: Extract<AiChoice, { source: "new" }>) {
  return {
    type: choice.type,
    apiKey: choice.apiKey?.trim() || undefined,
    model: choice.model?.trim() || undefined,
    baseUrl: choice.baseUrl?.trim() || undefined,
    role: choice.type === "meta" ? ("both" as const) : ("writer" as const),
  };
}

/** Links the new book to its AI. A new key is saved to the creator's models so the next book can reuse it. */
export async function applyAiChoice(userId: string, bookId: string, choice: AiChoice) {
  switch (choice.source) {
    case "new": {
      const view = await providerStore.create(userId, newProviderBody(choice));
      await prisma.book.update({ where: { id: bookId }, data: { aiProviderId: view.id, aiModel: "" } });
      return;
    }
    case "provider": {
      const view = (await providerStore.list(userId)).find((item) => item.id === choice.providerId);
      const model = choice.model?.trim() && view && choice.model.trim() !== view.model ? choice.model.trim() : "";
      await prisma.book.update({ where: { id: bookId }, data: { aiProviderId: choice.providerId, aiModel: model } });
      return;
    }
    case "book": {
      const from = await prisma.book.findFirst({ where: { id: choice.bookId, creatorId: userId }, select: { aiKeyCipher: true } });
      if (from?.aiKeyCipher) await prisma.book.update({ where: { id: bookId }, data: { aiKeyCipher: from.aiKeyCipher } });
      return;
    }
    default:
      return;
  }
}

/** Sets (or clears) which saved model a book runs on. */
export async function setBookModel(userId: string, bookId: string, providerId: string, model: string) {
  if (providerId) {
    const view = (await providerStore.list(userId)).find((item) => item.id === providerId);
    if (!view || !usableProvider(view, !localModelsOff())) throw new AppError("That model is not in your list.");
    model = model.trim() && model.trim() !== view.model ? model.trim().slice(0, 200) : "";
  } else model = "";
  await prisma.book.update({ where: { id: bookId }, data: { aiProviderId: providerId, aiModel: model } });
}
