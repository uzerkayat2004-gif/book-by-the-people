import { describe, expect, it } from "vitest";
import { createProviderStore, type ProviderDb, type ProviderRow } from "./provider-store";
import { keyLast4, openKey, sealKey } from "../secret-box";

const SECRET = "provider-store-test-secret";

function fakeDb() {
  const rows: (ProviderRow & { createdAt: Date })[] = [];
  let n = 0;
  const db: ProviderDb = {
    async findMany({ where }) {
      return rows
        .filter((row) => row.userId === where.userId && (where.enabled === undefined || row.enabled === where.enabled))
        .sort((a, b) => a.priority - b.priority || a.createdAt.getTime() - b.createdAt.getTime())
        .map((row) => ({ ...row }));
    },
    async findFirst({ where }) {
      const row = rows.find((item) => item.id === where.id && item.userId === where.userId);
      return row ? { ...row } : null;
    },
    async create({ data }) {
      const row = { ...data, id: `p${++n}`, lastTestOk: null, lastTestMsg: "", lastTestAt: null, createdAt: new Date(Date.now() + n) };
      rows.push(row);
      return { ...row };
    },
    async update({ where, data }) {
      const row = rows.find((item) => item.id === where.id)!;
      Object.assign(row, data);
      return { ...row };
    },
    async delete({ where }) {
      rows.splice(rows.findIndex((item) => item.id === where.id), 1);
      return {};
    },
  };
  return { db, rows };
}

function store() {
  const { db, rows } = fakeDb();
  const sealer = { seal: (plain: string) => sealKey(plain, SECRET), open: (sealed: string) => openKey(sealed, SECRET), last4: keyLast4 };
  return { store: createProviderStore(db, sealer), rows };
}

describe("AI provider store", () => {
  it("prefills from the type, encrypts the key and never returns it", async () => {
    const { store: s, rows } = store();
    const view = await s.create("u1", { type: "gemini", apiKey: "AIzaSyTESTKEY1234abcd" });
    expect(view.baseUrl).toContain("generativelanguage.googleapis.com");
    expect(view.model).toBeTruthy();
    expect(view.hasKey).toBe(true);
    expect(view.keyLast4).toBe("abcd");
    expect(JSON.stringify(view)).not.toContain("AIzaSyTESTKEY1234abcd");
    expect(JSON.stringify(view)).not.toContain("keyCipher");
    expect(rows[0].keyCipher).not.toContain("TESTKEY");
    expect(JSON.stringify(await s.list("u1"))).not.toContain("TESTKEY");
  });

  it("rejects bad input", async () => {
    const { store: s } = store();
    await expect(s.create("u1", { type: "openai" })).rejects.toThrow(/key/i);
    await expect(s.create("u1", { type: "openai", apiKey: "short" })).rejects.toThrow(/API key/);
    await expect(s.create("u1", { type: "custom", baseUrl: "ftp://x", model: "m" })).rejects.toThrow(/http/);
    await expect(s.create("u1", { type: "custom", baseUrl: "https://user:pw@x.dev/v1", model: "m" })).rejects.toThrow(/URL/);
    await expect(s.create("u1", { type: "gemini", apiKey: "AIzaSyTESTKEY1234", role: "transcription" })).rejects.toThrow();
    await expect(s.create("u1", { type: "nope", apiKey: "AIzaSyTESTKEY1234" })).rejects.toThrow();
  });

  it("works without a key for Ollama and strips a trailing slash", async () => {
    const { store: s } = store();
    const view = await s.create("u1", { type: "ollama", baseUrl: "http://127.0.0.1:11434/v1/" });
    expect(view.baseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(view.hasKey).toBe(false);
  });

  it("orders by priority, filters by role and opens keys only on the server chain", async () => {
    const { store: s } = store();
    const a = await s.create("u1", { type: "openai", apiKey: "sk-test-aaaa1111", role: "both" });
    const b = await s.create("u1", { type: "groq", apiKey: "gsk-test-bbbb2222", role: "transcription" });
    const c = await s.create("u1", { type: "anthropic", apiKey: "sk-ant-cccc3333" });
    await s.create("u2", { type: "openai", apiKey: "sk-other-user999" });
    expect((await s.list("u1")).map((row) => row.id)).toEqual([a.id, b.id, c.id]);
    await s.reorder("u1", [c.id, a.id, b.id]);
    const writers = await s.chain("u1", "writer");
    expect(writers.map((row) => row.id)).toEqual([c.id, a.id]);
    expect(writers[0].apiKey).toBe("sk-ant-cccc3333");
    const hearers = await s.chain("u1", "transcription");
    expect(hearers.map((row) => row.id)).toEqual([a.id, b.id]);
    await s.update("u1", a.id, { enabled: false });
    expect((await s.chain("u1", "writer")).map((row) => row.id)).toEqual([c.id]);
  });

  it("skips a provider whose key no longer decrypts", async () => {
    const { store: s, rows } = store();
    const a = await s.create("u1", { type: "openai", apiKey: "sk-test-aaaa1111" });
    const b = await s.create("u1", { type: "openrouter", apiKey: "sk-or-bbbb2222" });
    rows.find((row) => row.id === a.id)!.keyCipher = sealKey("sk-test-aaaa1111", "a-different-secret-entirely");
    expect((await s.chain("u1", "writer")).map((row) => row.id)).toEqual([b.id]);
  });

  it("keeps the key on edit, replaces or clears it, and resets the test result", async () => {
    const { store: s } = store();
    const a = await s.create("u1", { type: "openai", apiKey: "sk-test-aaaa1111" });
    await s.recordTest(a.id, true, "ok");
    let view = await s.update("u1", a.id, { label: "Renamed" });
    expect(view.keyLast4).toBe("1111");
    expect(view.lastTestOk).toBe(true);
    view = await s.update("u1", a.id, { apiKey: "sk-test-zzzz9999" });
    expect(view.keyLast4).toBe("9999");
    expect(view.lastTestOk).toBeNull();
    expect((await s.resolve("u1", a.id)).apiKey).toBe("sk-test-zzzz9999");
    await expect(s.update("u2", a.id, { label: "x" })).rejects.toThrow();
    await s.remove("u1", a.id);
    expect(await s.list("u1")).toEqual([]);
  });
});
