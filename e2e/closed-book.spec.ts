import { expect, test } from "@playwright/test";
import { BASE, signInRequest } from "./helpers";

test("a closed book shows 'Voices are closed' on every voice link and refuses new voices", async ({ page, request, browser }) => {
  await signInRequest(request, `closer-${Date.now()}@example.com`);
  const created = await request.post("/api/books", {
    headers: { origin: BASE },
    data: { title: `Closed ${Date.now()}`, question: "What did the year teach you?", type: "OPEN", closesAt: null, ai: { source: "demo" } },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const book = await created.json();
  const closed = await request.post(`/api/books/${book.id}/close`, { headers: { origin: BASE } });
  expect(closed.ok(), await closed.text()).toBeTruthy();

  for (const link of ["", "?step=1", "?step=2", "?guest=1", "?guest=1&step=1"]) {
    await page.goto(`/b/${book.slug}/voice${link}`);
    await expect(page.getByRole("heading", { name: /Voices are closed/i })).toBeVisible();
    await expect(page.getByTestId("words")).toHaveCount(0);
    await expect(page.getByTestId("mic")).toHaveCount(0);
  }

  // The server says no too, for a guest and for a signed-in person.
  const guest = await browser.newContext({ baseURL: BASE });
  const line = "This is a long enough answer that would normally be accepted by the book.";
  const data = { text: line, mode: "write", name: "Late Guest", consent: true, metrics: { activeMs: 30_000, keys: line.length, spoken: 0 } };
  const asGuest = await guest.request.post(`/api/books/${book.id}/voices`, { headers: { origin: BASE }, data });
  expect(asGuest.status()).toBe(403);
  const asUser = await request.post(`/api/books/${book.id}/voices`, { headers: { origin: BASE }, data });
  expect(asUser.status()).toBe(403);
  await guest.close();
});
