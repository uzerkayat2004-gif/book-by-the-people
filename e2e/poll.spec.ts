import { expect, test } from "@playwright/test";
import { BASE, signIn } from "./helpers";

async function freshBook(page: import("@playwright/test").Page, title: string) {
  const created = await page.request.post("/api/books", {
    headers: { origin: BASE },
    data: { title, question: `${title}: what did you learn?`, type: "OPEN", coverVibe: "ember", closesAt: null, ai: { source: "demo" } },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  return created.json() as Promise<{ id: string; slug: string }>;
}

test("next-book poll: a guest can vote while the book is open; the vote sticks after reload, once only", async ({ page, browser }) => {
  await signIn(page, `poll-owner-${Date.now()}@example.com`);
  const book = await freshBook(page, `Poll open ${Date.now()}`);
  const guest = await browser.newContext({ baseURL: BASE });
  const g = await guest.newPage();
  await g.goto(`/b/${book.slug}?guest=1`);
  const poll = g.getByTestId("poll");
  await poll.scrollIntoViewIfNeeded();
  await expect(g.getByTestId("poll-total")).toContainText("0");
  const first = g.getByTestId("poll-option").first();
  await expect(first).toBeEnabled();
  const [voted] = await Promise.all([g.waitForResponse((r) => r.url().includes("/poll") && r.request().method() === "POST"), first.click()]);
  const body = (await voted.json()) as { options: { id: string }[]; yourVote: string };
  await expect(first).toContainText("✓ Your vote");
  await expect(g.getByTestId("poll-total")).toContainText("1");
  await g.reload();
  await expect(g.getByTestId("poll-option").first()).toContainText("✓ Your vote");
  await expect(g.getByTestId("poll-total")).toContainText("1");
  // A second vote from the same browser does not count again.
  // A second vote from the same browser, for another choice, does not count: the first vote stands.
  const second = await g.request.post(`/api/books/${book.id}/poll`, { headers: { origin: BASE }, data: { optionId: body.options[1].id } });
  expect(second.ok()).toBeTruthy();
  const after = (await second.json()) as { options: { votes: number }[]; yourVote: string };
  expect(after.yourVote).toBe(body.yourVote);
  expect(after.options.reduce((sum, o) => sum + o.votes, 0)).toBe(1);
  await guest.close();

  // The signed-in owner votes too: counts go to 2.
  await page.goto(`/b/${book.slug}`);
  await page.getByTestId("poll-option").nth(1).click();
  await expect(page.getByTestId("poll-option").nth(1)).toContainText("✓ Your vote");
  await expect(page.getByTestId("poll-total")).toContainText("2");
  await page.reload();
  await expect(page.getByTestId("poll-option").nth(1)).toContainText("✓ Your vote");
});
