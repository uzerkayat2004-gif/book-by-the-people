import { expect, test } from "@playwright/test";
import { BASE, signIn } from "./helpers";

test("a creator runs several open books at once; each has its own voice page and studio", async ({ page, browser }) => {
  const email = `multi-${Date.now()}@example.com`;
  await signIn(page, email);
  const stamp = Date.now().toString(36);
  const made: { id: string; slug: string; title: string }[] = [];
  for (const title of [`First ${stamp}`, `Second ${stamp}`]) {
    const res = await page.request.post("/api/books", {
      headers: { origin: BASE },
      data: { title, question: `${title}: what changed for you?`, type: "OPEN", closesAt: null, ai: { source: "demo" } },
    });
    expect(res.ok()).toBeTruthy();
    made.push({ ...(await res.json()), title });
  }

  // Both are listed in Books and take voices; each link goes to that book's own voice page.
  await page.goto(`/books?q=${stamp}`);
  const openNow = page.getByTestId("open-now");
  await expect(openNow).toBeVisible();
  for (const book of made) {
    const card = openNow.getByTestId("open-card").filter({ hasText: book.title });
    await expect(card).toHaveCount(1);
    await expect(card.getByRole("link", { name: /add your voice/i })).toHaveAttribute("href", `/b/${book.slug}/voice`);
  }

  // The Studio switcher lists both with an "Open" chip and a New book link.
  await page.goto(`/studio/${made[0].slug}`);
  await page.locator("summary[aria-label='Switch book']").click();
  const menu = page.locator(".s2-books__pop");
  await expect(menu).toContainText(/open now/i);
  for (const book of made) {
    const item = menu.getByRole("menuitem", { name: new RegExp(book.title) });
    await expect(item).toBeVisible();
    await expect(item.locator(".s5-bk__s")).toHaveText("Open");
  }
  await expect(menu.getByRole("menuitem", { name: /new book/i })).toHaveAttribute("href", "/books/new");
  await menu.getByRole("menuitem", { name: new RegExp(made[1].title) }).click();
  await expect(page).toHaveURL(new RegExp(`/studio/${made[1].slug}`));

  // Home placement lives in Book settings.
  await page.goto(`/studio/${made[1].slug}?tab=settings`);
  await expect(page.getByTestId("home-placement")).toBeVisible();

  // The Studio shows the book's own link, copy + share, and an Unlisted switch.
  await page.goto(`/studio/${made[0].slug}`);
  const share = page.getByTestId("studio-share");
  await expect(share).toContainText(`/b/${made[0].slug}`);
  await expect(share.getByRole("button", { name: /copy book link/i })).toBeVisible();
  const saved = page.waitForResponse((res) => res.url().endsWith(`/api/books/${made[0].id}`) && res.request().method() === "PATCH");
  await share.getByRole("switch", { name: /show in books/i }).click();
  expect((await saved).ok()).toBeTruthy();
  await expect(share).toContainText(/unlisted/i);
  await page.goto(`/books?q=${stamp}`);
  await expect(page.getByTestId("open-card").filter({ hasText: made[0].title })).toHaveCount(0);
  await expect(page.getByTestId("open-card").filter({ hasText: made[1].title })).toHaveCount(1);

  // A visitor from the link sees just that book and one way to the others.
  await page.goto(`/b/${made[0].slug}`);
  await expect(page.getByTestId("book-foot").getByRole("link", { name: /see other books/i })).toHaveAttribute("href", "/books");
  await expect(page.getByTestId("sealed-panel")).toBeVisible();

  // Someone else can't feature this creator's book.
  const other = await browser.newContext({ baseURL: BASE });
  const otherPage = await other.newPage();
  await signIn(otherPage, `intruder-${Date.now()}@example.com`);
  const denied = await otherPage.request.post(`/api/books/${made[1].id}/feature`, { headers: { origin: BASE }, data: { featured: true } });
  expect([403, 404]).toContain(denied.status());
  // ...or delete it, or open its studio.
  const noDelete = await otherPage.request.delete(`/api/books/${made[1].id}`, { headers: { origin: BASE } });
  expect(noDelete.status()).toBe(404);
  const studio = await otherPage.goto(`/studio/${made[1].slug}`);
  expect(studio?.status()).toBe(404);
  await other.close();
});
