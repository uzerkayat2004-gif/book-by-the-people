/**
 * Where a new book's AI comes from. Every book needs one: a new key, a saved model,
 * a key saved on another book, a local model (only where local models run), or the server's own key.
 * Shared by the create form and the server, so it stays free of server-only imports.
 */
import { z } from "zod";
import { isLocalType, roleIncludes, type ProviderView } from "./provider-types";

export const NO_AI_SOURCE = "Add your AI key, or pick a saved model.";

export const aiChoiceSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("new"),
    type: z.string().max(40),
    apiKey: z.string().max(600).optional(),
    model: z.string().max(200).optional(),
    baseUrl: z.string().max(400).optional(),
  }),
  z.object({ source: z.literal("provider"), providerId: z.string().min(1).max(40), model: z.string().max(200).optional() }),
  z.object({ source: z.literal("book"), bookId: z.string().min(1).max(40) }),
  z.object({ source: z.literal("server") }),
  z.object({ source: z.literal("demo") }),
]);

export type AiChoice = z.infer<typeof aiChoiceSchema>;

/** A saved model the creator can pick, as the form shows it. Never a key. */
export type SavedAiOption = {
  id: string;
  kind: "provider" | "book";
  label: string;
  detail: string;
  type: string;
  model: string;
  local: boolean;
};

export type AiOptions = {
  saved: SavedAiOption[];
  /** Local models run on this server (off on hosted sites). */
  localOn: boolean;
  /** The server has its own key (self-hosted). */
  serverKey: boolean;
  /** Dev only: books may run in demo mode with no AI. */
  demo: boolean;
};

/** A provider can run a new book when it writes, is on, and has a key (or needs none). */
export function usableProvider(view: ProviderView, localOn: boolean): boolean {
  if (!view.enabled || !roleIncludes(view.role, "writer")) return false;
  if (isLocalType(view.type)) return localOn;
  return view.hasKey || view.type === "custom";
}

/**
 * Turns whatever the form (or an API caller) sent into one checked choice.
 * `legacyKey` is the old `aiKey` field: a pasted Meta key.
 */
export function parseAiChoice(raw: unknown, legacyKey: string | undefined, options: AiOptions): AiChoice {
  let choice: AiChoice | null = null;
  if (raw !== undefined && raw !== null) {
    const parsed = aiChoiceSchema.safeParse(raw);
    if (!parsed.success) throw new Error(NO_AI_SOURCE);
    choice = parsed.data;
  } else if (legacyKey?.trim()) {
    choice = { source: "new", type: "meta", apiKey: legacyKey.trim() };
  }
  if (!choice) throw new Error(NO_AI_SOURCE);
  switch (choice.source) {
    case "new":
      if (choice.type !== "custom" && !choice.apiKey?.trim()) throw new Error("Paste your AI key.");
      return choice;
    case "provider":
    case "book": {
      const id = choice.source === "provider" ? choice.providerId : choice.bookId;
      const hit = options.saved.find((item) => item.kind === choice.source && item.id === id);
      if (!hit) throw new Error("That saved model is not available. Pick another, or use a new key.");
      return choice;
    }
    case "server":
      if (!options.serverKey) throw new Error(NO_AI_SOURCE);
      return choice;
    case "demo":
      if (!options.demo) throw new Error(NO_AI_SOURCE);
      return choice;
  }
}
