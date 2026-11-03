import { expect, request as pwRequest, test } from "@playwright/test";
import { BASE, signInRequest } from "./helpers";

const stamp = Date.now();
const metrics = (text: string) => ({ activeMs: 30_000, keys: text.length, spoken: 0 });

test("waiting list: a famous name waits for the owner for the owner, who can approve or reject; only the owner can", async ({ request }) => {
  await signInRequest(request, `wait-owner-${stamp}@example.com`);
  const created = await request.post("/api/books", {
    headers: { origin: BASE },
    data: { title: `Night shift ${stamp}`, question: "What keeps you awake on a night shift?", type: "OPEN", closesAt: null, ai: { source: "demo" } },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const book = await created.json();

  const send = async (ctx: import("@playwright/test").APIRequestContext, text: string, name: string) => {
    const res = await ctx.post(`/api/books/${book.id}/voices`, { headers: { origin: BASE }, data: { text, mode: "write", name, country: "IN", consent: true, metrics: metrics(text) } });
    expect(res.ok(), await res.text()).toBeTruthy();
    return res.json() as Promise<{ id: string; status: string }>;
  };
  const guestA = await pwRequest.newContext({ baseURL: BASE });
  const guestB = await pwRequest.newContext({ baseURL: BASE });
  const onTopic = await send(guestA, "On a night shift I stay awake with strong tea, the radio, and the people who come in needing help at three.", "Asha");
  expect(onTopic.status).toBe("READY");
  // Demo mode holds a voice signed with a famous name (live mode also holds off-question ones).
  const offA = await send(guestA, "Coffee from the hospital machine and the quiet hallway at four keep me going through the long night shift.", "Taylor Swift");
  const offB = await send(guestB, "Night shifts at the warehouse mean loud music in my headphones and a cold walk outside at every break.", "Elon Musk");
  expect(offA.status).toBe("NEEDS_YOU");
  expect(offB.status).toBe("NEEDS_YOU");

  // Someone else cannot decide for the owner.
  const outsider = await pwRequest.newContext({ baseURL: BASE });
  await signInRequest(outsider, `wait-outsider-${stamp}@example.com`);
  const sneaky = await outsider.patch(`/api/voices/${offA.id}`, { headers: { origin: BASE }, data: { decision: "approved" } });
  expect(sneaky.ok()).toBeFalsy();
  const anon = await guestA.patch(`/api/voices/${offA.id}`, { headers: { origin: BASE }, data: { decision: "approved" } });
  expect(anon.status()).toBe(401);

  const approve = await request.patch(`/api/voices/${offA.id}`, { headers: { origin: BASE }, data: { decision: "approved" } });
  expect(approve.ok(), await approve.text()).toBeTruthy();
  const reject = await request.patch(`/api/voices/${offB.id}`, { headers: { origin: BASE }, data: { decision: "hidden" } });
  expect(reject.ok(), await reject.text()).toBeTruthy();
  expect((await reject.json()).hidden).toBe(true);

  // The public book page counts the approved voice but not the rejected one.
  const page = await request.get(`/b/${book.slug}`);
  const html = await page.text();
  expect(html).toContain("Asha");
  expect(html).toContain("Taylor Swift");
  expect(html).not.toContain("Elon Musk");
  for (const c of [guestA, guestB, outsider]) await c.dispose();
});

test("a signed-in person gets 3 voices a day per book, then a kind 429", async ({ request }) => {
  await signInRequest(request, `wait-limit-${stamp}@example.com`);
  const created = await request.post("/api/books", {
    headers: { origin: BASE },
    data: { title: `Limit ${stamp}`, question: "What keeps you going?", type: "OPEN", closesAt: null, ai: { source: "demo" } },
  });
  const book = await created.json();
  const user = await pwRequest.newContext({ baseURL: BASE });
  await signInRequest(user, `wait-limit-user-${stamp}@example.com`);
  const send = (n: number) => {
    const text = `Small walks in the evening keep me going on the hard days, note number ${n} from me.`;
    return user.post(`/api/books/${book.id}/voices`, { headers: { origin: BASE }, data: { text, mode: "write", name: "Walker", consent: true, metrics: metrics(text) } });
  };
  for (const n of [1, 2, 3]) expect((await send(n)).ok()).toBeTruthy();
  const fourth = await send(4);
  expect(fourth.status()).toBe(429);
  await user.dispose();
});
