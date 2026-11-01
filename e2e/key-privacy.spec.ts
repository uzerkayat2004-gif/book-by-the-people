import { expect, request as pwRequest, test } from "@playwright/test";
import { BASE, signInRequest } from "./helpers";

// Made-up keys shaped like real ones. They are never sent to any provider here (no test call is made).
const stamp = Date.now().toString(36);
const GEMINI = `AIza${"Q".repeat(10)}${stamp}fakeGeminiKeyW1x2`;
const META = `LLM|${"7".repeat(12)}|fakeMetaKey${stamp}Z9y8`;
const BOOK_KEY = `LLM|${"5".repeat(12)}|fakeBookKey${stamp}K4j3`;
const KEYS = [GEMINI, META, BOOK_KEY];
// A middle slice of each key: if any of it shows up anywhere, the key leaked.
const leaks = (text: string) => KEYS.filter((key) => text.includes(key) || text.includes(key.slice(6, -4)));

test("saved AI keys stay sealed: only the owner sees the last 4, nobody gets the key", async ({ request }) => {
  const owner = `keys-owner-${stamp}@example.com`;
  await signInRequest(request, owner);
  const created = await request.post("/api/books", {
    headers: { origin: BASE },
    data: { title: `Key privacy ${stamp}`, question: "What did you learn the hard way?", type: "OPEN", coverVibe: "ember", closesAt: null, ai: { source: "demo" } },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const book = await created.json();

  const ids: string[] = [];
  for (const [type, apiKey] of [["gemini", GEMINI], ["meta", META]]) {
    const res = await request.post("/api/ai/providers", { headers: { origin: BASE }, data: { type, apiKey, role: "writer" } });
    const text = await res.text();
    expect(res.ok(), text.slice(0, 200)).toBeTruthy();
    expect(leaks(text)).toEqual([]);
    const { provider } = JSON.parse(text);
    expect(provider.hasKey).toBe(true);
    expect(provider.keyLast4).toBe(apiKey.slice(-4));
    expect(Object.keys(provider)).not.toContain("keyCipher");
    expect(Object.keys(provider)).not.toContain("apiKey");
    ids.push(provider.id);
  }
  const saved = await request.patch(`/api/books/${book.id}`, { headers: { origin: BASE }, data: { aiKey: BOOK_KEY } });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  expect(leaks(await saved.text())).toEqual([]);

  // The owner: every page and answer shows at most the last 4.
  for (const path of ["/api/ai/providers", "/api/me", `/studio/${book.id}`, `/studio/${book.id}?tab=ai`, "/studio", `/b/${book.slug}`, "/api/health"]) {
    const res = await request.get(path);
    const text = await res.text();
    expect(leaks(text), path).toEqual([]);
  }
  const studio = await (await request.get(`/studio/${book.id}`)).text();
  expect(studio).toContain(BOOK_KEY.slice(-4));
  expect(studio).not.toMatch(/v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\./); // no sealed value in the page either
  const mine = await (await request.get("/api/ai/providers")).json();
  expect(mine.providers.map((item: { keyLast4: string }) => item.keyLast4).sort()).toEqual([GEMINI.slice(-4), META.slice(-4)].sort());
  expect(JSON.stringify(mine)).not.toMatch(/keyCipher|"apiKey"|v1\.[A-Za-z0-9_-]{16}\./);

  // Someone else, signed in.
  const other = await pwRequest.newContext({ baseURL: BASE });
  await signInRequest(other, `keys-other-${stamp}@example.com`);
  const theirs = await other.get("/api/ai/providers");
  const theirsText = await theirs.text();
  expect(leaks(theirsText)).toEqual([]);
  expect(JSON.parse(theirsText).providers).toEqual([]);
  for (const id of ids) {
    expect((await other.patch(`/api/ai/providers/${id}`, { headers: { origin: BASE }, data: { label: "mine now" } })).status()).toBe(404);
    expect((await other.post(`/api/ai/providers/${id}/test`, { headers: { origin: BASE } })).status()).toBe(404);
    expect((await other.delete(`/api/ai/providers/${id}`, { headers: { origin: BASE } })).status()).toBe(404);
  }
  expect((await other.patch(`/api/books/${book.id}`, { headers: { origin: BASE }, data: { aiKey: `LLM|${"1".repeat(12)}|hijack${stamp}` } })).ok()).toBeFalsy();
  expect((await other.patch(`/api/books/${book.id}`, { headers: { origin: BASE }, data: { clearAiKey: true } })).ok()).toBeFalsy();
  expect((await other.post(`/api/books/${book.id}/tick`, { headers: { origin: BASE } })).ok()).toBeFalsy();
  expect((await other.post(`/api/books/${book.id}/generate`, { headers: { origin: BASE } })).ok()).toBeFalsy();
  expect((await other.post(`/api/books/${book.id}/translations`, { headers: { origin: BASE }, data: { run: true } })).ok()).toBeFalsy();
  // A new book can't borrow another creator's saved key or model.
  const borrow = await other.post("/api/books", {
    headers: { origin: BASE },
    data: { title: `Borrow ${stamp}`, question: "Can I use your key?", type: "OPEN", coverVibe: "ember", closesAt: null, ai: { source: "provider", providerId: ids[0] } },
  });
  expect(borrow.ok()).toBeFalsy();
  const borrowBook = await other.post("/api/books", {
    headers: { origin: BASE },
    data: { title: `Borrow2 ${stamp}`, question: "Can I use your key?", type: "OPEN", coverVibe: "ember", closesAt: null, ai: { source: "book", bookId: book.id } },
  });
  expect(borrowBook.ok()).toBeFalsy();
  for (const path of [`/studio/${book.id}`, `/b/${book.slug}`, "/api/me"]) {
    const res = await other.get(path);
    expect(leaks(await res.text()), path).toEqual([]);
  }
  expect((await other.get(`/studio/${book.id}`)).status()).toBe(404);
  await other.dispose();

  // Nobody signed in.
  const anon = await pwRequest.newContext({ baseURL: BASE });
  expect((await anon.get("/api/ai/providers")).status()).toBe(401);
  expect((await anon.post("/api/ai/providers", { headers: { origin: BASE }, data: { type: "gemini", apiKey: GEMINI } })).status()).toBe(401);
  expect((await anon.post("/api/ai/check", { headers: { origin: BASE }, data: { type: "gemini", apiKey: GEMINI } })).status()).toBe(401);
  for (const path of [`/b/${book.slug}`, "/", "/books", "/library", "/api/health", `/studio/${book.id}`]) {
    const res = await anon.get(path);
    expect(leaks(await res.text()), path).toEqual([]);
  }
  await anon.dispose();

  // Another site can't save or change keys with the owner's cookies.
  const cross = await request.post("/api/ai/providers", { headers: { origin: "https://evil.example" }, data: { type: "gemini", apiKey: GEMINI } });
  expect(cross.status()).toBe(403);
  const crossNoOrigin = await request.patch(`/api/books/${book.id}`, { headers: { "sec-fetch-site": "cross-site" }, data: { clearAiKey: true } });
  expect(crossNoOrigin.status()).toBe(403);

  // The owner can remove keys again.
  for (const id of ids) expect((await request.delete(`/api/ai/providers/${id}`, { headers: { origin: BASE } })).ok()).toBeTruthy();
  expect((await request.patch(`/api/books/${book.id}`, { headers: { origin: BASE }, data: { clearAiKey: true } })).ok()).toBeTruthy();
});

test("a guest's browser gets the same daily voice limit as a signed-in person", async ({ request }) => {
  await signInRequest(request, `keys-guestlimit-${stamp}@example.com`);
  const created = await request.post("/api/books", {
    headers: { origin: BASE },
    data: { title: `Guest limit ${stamp}`, question: "What keeps you going?", type: "OPEN", coverVibe: "ember", closesAt: null, ai: { source: "demo" } },
  });
  const book = await created.json();
  await request.patch(`/api/books/${book.id}`, { headers: { origin: BASE }, data: { voiceLimitPerDay: 2 } });
  const guest = await pwRequest.newContext({ baseURL: BASE });
  const send = (n: number) =>
    guest.post(`/api/books/${book.id}/voices`, {
      headers: { origin: BASE },
      data: { text: `Small walks in the evening keep me going on hard days, number ${n}.`, mode: "write", name: `Guest ${n}`, country: "IN", consent: true, metrics: { activeMs: 30_000, keys: 60, spoken: 0 } },
    });
  expect((await send(1)).ok()).toBeTruthy();
  expect((await send(2)).ok()).toBeTruthy();
  const third = await send(3);
  expect(third.status()).toBe(429);
  await guest.dispose();
});
