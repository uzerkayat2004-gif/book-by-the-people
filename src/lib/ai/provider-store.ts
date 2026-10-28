import { z } from "zod";
import { AppError } from "../errors";
import { isProviderType, presetFor, roleIncludes, type ProviderRole, type ProviderType, type ProviderView } from "./provider-types";

/** The row shape stored in the AiProvider table. */
export type ProviderRow = {
  id: string;
  userId: string;
  label: string;
  type: string;
  baseUrl: string;
  model: string;
  role: string;
  priority: number;
  enabled: boolean;
  keyCipher: string;
  keyLast4: string;
  localModel: string;
  lastTestOk: boolean | null;
  lastTestMsg: string;
  lastTestAt: Date | null;
};

/** A provider ready to call, with its key opened. Server only. */
export type ResolvedProvider = Omit<ProviderRow, "keyCipher"> & { apiKey: string; type: ProviderType; role: ProviderRole };

/** The part of a Prisma delegate the store uses, so tests can pass an in-memory fake. */
export type ProviderDb = {
  findMany(args: { where: { userId: string; enabled?: boolean }; orderBy?: unknown }): Promise<ProviderRow[]>;
  findFirst(args: { where: { id: string; userId: string } }): Promise<ProviderRow | null>;
  create(args: { data: Omit<ProviderRow, "id" | "lastTestOk" | "lastTestMsg" | "lastTestAt"> }): Promise<ProviderRow>;
  update(args: { where: { id: string }; data: Partial<ProviderRow> }): Promise<ProviderRow>;
  delete(args: { where: { id: string } }): Promise<unknown>;
};

export type Sealer = { seal(plain: string): string; open(sealed: string): string; last4(plain: string): string };

const inputSchema = z.object({
  label: z.string().trim().max(60).optional(),
  type: z.string().optional(),
  baseUrl: z.string().trim().max(400).optional(),
  model: z.string().trim().max(200).optional(),
  role: z.enum(["writer", "transcription", "both"]).optional(),
  enabled: z.boolean().optional(),
  apiKey: z.string().max(600).optional(),
  clearKey: z.boolean().optional(),
  localModel: z.string().max(80).optional(),
});

export type ProviderInput = z.infer<typeof inputSchema>;

export function cleanBaseUrl(raw: string): string {
  const value = raw.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError("The base URL must start with http:// or https://.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new AppError("The base URL must start with http:// or https://.");
  if (url.username || url.password) throw new AppError("Put the key in the API key field, not in the URL.");
  return value;
}

function checkKey(key: string) {
  if (key.length < 8 || /\s/.test(key)) throw new AppError("That doesn't look like an API key.");
}

/** Checks a new model's fields without saving anything. Throws a short AppError. */
export function checkProviderInput(raw: unknown) {
  const input = inputSchema.parse(raw);
  const type = input.type ?? "";
  if (!isProviderType(type)) throw new AppError("Pick a provider type.");
  const preset = presetFor(type);
  const role = input.role ?? "writer";
  if (roleIncludes(role, "transcription") && !canTranscribe(type)) {
    throw new AppError(`${preset.name} can't transcribe voices here. Pick "Writer".`);
  }
  if (type === "custom" && !(input.baseUrl ?? "").trim()) throw new AppError("Add the base URL.");
  const baseUrl = cleanBaseUrl(input.baseUrl || preset.baseUrl);
  const model = (input.model || preset.model).trim();
  if (!model) throw new AppError("Add a model name.");
  const key = (input.apiKey ?? "").trim();
  if (key) checkKey(key);
  else if (preset.keyRequired) throw new AppError(`Paste your ${preset.name.split(" ·")[0]} key.`);
  return { input, type, preset, role, baseUrl, model, key };
}

export function canTranscribe(type: string): boolean {
  return Boolean(presetFor(type).transcribeModel) || type === "custom";
}

export function toView(row: ProviderRow): ProviderView {
  const type = (isProviderType(row.type) ? row.type : "custom") as ProviderType;
  return {
    id: row.id,
    label: row.label,
    type,
    typeName: presetFor(type).name,
    baseUrl: row.baseUrl,
    model: row.model,
    role: (["writer", "transcription", "both"].includes(row.role) ? row.role : "writer") as ProviderRole,
    priority: row.priority,
    enabled: row.enabled,
    hasKey: Boolean(row.keyCipher),
    keyLast4: row.keyCipher ? row.keyLast4 : "",
    localModel: row.localModel,
    canTranscribe: canTranscribe(type),
    lastTestOk: row.lastTestOk,
    lastTestMsg: row.lastTestMsg,
    lastTestAt: row.lastTestAt ? row.lastTestAt.toISOString() : null,
  };
}

const ORDER = [{ priority: "asc" }, { createdAt: "asc" }];

export function createProviderStore(db: ProviderDb, sealer: Sealer) {
  async function owned(userId: string, id: string) {
    const row = await db.findFirst({ where: { id, userId } });
    if (!row) throw new AppError("That AI model is not in your list.", 404);
    return row;
  }

  async function list(userId: string): Promise<ProviderView[]> {
    return (await db.findMany({ where: { userId }, orderBy: ORDER })).map(toView);
  }

  async function create(userId: string, raw: unknown): Promise<ProviderView> {
    const { input, type, preset, role, baseUrl, model, key } = checkProviderInput(raw);
    const existing = await db.findMany({ where: { userId }, orderBy: ORDER });
    const priority = existing.reduce((max, row) => Math.max(max, row.priority), -1) + 1;
    const row = await db.create({
      data: {
        userId,
        label: (input.label || preset.name).slice(0, 60),
        type,
        baseUrl,
        model,
        role,
        priority,
        enabled: input.enabled ?? true,
        keyCipher: key ? sealer.seal(key) : "",
        keyLast4: key ? sealer.last4(key) : "",
        localModel: input.localModel ?? "",
      },
    });
    return toView(row);
  }

  async function update(userId: string, id: string, raw: unknown): Promise<ProviderView> {
    const input = inputSchema.parse(raw);
    const row = await owned(userId, id);
    const data: Partial<ProviderRow> = {};
    const type = input.type ?? row.type;
    if (!isProviderType(type)) throw new AppError("Pick a provider type.");
    if (input.type !== undefined) data.type = type;
    if (input.label !== undefined) data.label = input.label || presetFor(type).name;
    if (input.baseUrl !== undefined) data.baseUrl = cleanBaseUrl(input.baseUrl || presetFor(type).baseUrl);
    if (input.model !== undefined) {
      if (!input.model.trim()) throw new AppError("Add a model name.");
      data.model = input.model.trim();
    }
    const role = input.role ?? row.role;
    if (roleIncludes(role, "transcription") && !canTranscribe(type)) {
      throw new AppError(`${presetFor(type).name} can't transcribe voices here. Pick "Writer".`);
    }
    if (input.role !== undefined) data.role = input.role;
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.clearKey) {
      data.keyCipher = "";
      data.keyLast4 = "";
    }
    const key = (input.apiKey ?? "").trim();
    if (key) {
      checkKey(key);
      data.keyCipher = sealer.seal(key);
      data.keyLast4 = sealer.last4(key);
    }
    if (Object.keys(data).some((field) => ["type", "baseUrl", "model", "keyCipher"].includes(field))) {
      data.lastTestOk = null;
      data.lastTestMsg = "";
      data.lastTestAt = null;
    }
    return toView(await db.update({ where: { id: row.id }, data }));
  }

  async function remove(userId: string, id: string) {
    const row = await owned(userId, id);
    await db.delete({ where: { id: row.id } });
  }

  /** Sets priority from the order of ids. Ids not listed keep their relative order after the listed ones. */
  async function reorder(userId: string, ids: string[]): Promise<ProviderView[]> {
    const rows = await db.findMany({ where: { userId }, orderBy: ORDER });
    const known = new Set(rows.map((row) => row.id));
    const wanted = ids.filter((id, index) => known.has(id) && ids.indexOf(id) === index);
    const rest = rows.map((row) => row.id).filter((id) => !wanted.includes(id));
    const order = [...wanted, ...rest];
    for (const [index, id] of order.entries()) {
      const row = rows.find((item) => item.id === id);
      if (row && row.priority !== index) await db.update({ where: { id }, data: { priority: index } });
    }
    return list(userId);
  }

  /** Enabled providers for a job, in priority order, keys opened. */
  async function chain(userId: string, want: "writer" | "transcription"): Promise<ResolvedProvider[]> {
    const rows = await db.findMany({ where: { userId, enabled: true }, orderBy: ORDER });
    const out: ResolvedProvider[] = [];
    for (const row of rows) {
      if (!roleIncludes(row.role, want)) continue;
      if (want === "transcription" && !canTranscribe(row.type)) continue;
      let apiKey = "";
      if (row.keyCipher) {
        try {
          apiKey = sealer.open(row.keyCipher);
        } catch {
          continue; // The secret changed; this key can't be read. Skip to the next provider.
        }
      }
      const { keyCipher: _sealed, ...rest } = row;
      void _sealed;
      out.push({ ...rest, apiKey, type: (isProviderType(row.type) ? row.type : "custom") as ProviderType, role: row.role as ProviderRole });
    }
    return out;
  }

  async function resolve(userId: string, id: string): Promise<ResolvedProvider> {
    const row = await owned(userId, id);
    const apiKey = row.keyCipher ? sealer.open(row.keyCipher) : "";
    const { keyCipher: _sealed, ...rest } = row;
    void _sealed;
    return { ...rest, apiKey, type: (isProviderType(row.type) ? row.type : "custom") as ProviderType, role: row.role as ProviderRole };
  }

  async function recordTest(id: string, ok: boolean, message: string) {
    await db.update({ where: { id }, data: { lastTestOk: ok, lastTestMsg: message.slice(0, 300), lastTestAt: new Date() } });
  }

  return { list, create, update, remove, reorder, chain, resolve, recordTest };
}
