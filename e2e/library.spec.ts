import { expect, test } from "@playwright/test";
import { BASE, signIn } from "./helpers";

test("Library lists released books only and opens each one", async ({ page }) => {
  // An unreleased invited book and a draft-stage open book must never be listed.
  await signIn(page, `lib-${Date.now()}@example.com`);
  const stamp = Date.now().toString(36);
  const invited = await page.request.post("/api/books", {
    headers: { origin: BASE },
    data: { title: `Private ${stamp}`, question: "Who is at the table?", type: "INVITED", closesAt: null },
  });
  expect(invited.ok()).toBeTruthy();
  const open = await page.request.post("/api/books", {
    headers: { origin: BASE },
    data: { title: `Open ${stamp}`, question: "What did you learn this week?", type: "OPEN", closesAt: null },
  });
  expect(open.ok()).toBeTruthy();
  const openBook = await open.json();

  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
  const list = page.getByTestId("library-list");
  await expect(list).toBeVisible();
  const cards = list.getByTestId("released-card");
  expect(await cards.count()).toBeGreaterThan(0);
  await expect(list).not.toContainText(`Private ${stamp}`);
  await expect(list).not.toContainText(`Open ${stamp}`);
  // Each card says when it came out and links to the reader.
  await expect(cards.first()).toContainText(/Released [A-Z][a-z]{2} \d{1,2}, \d{4}/);
  await expect(cards.first().getByRole("link", { name: "Read" })).toHaveAttribute("href", /^\/b\/[^/]+\/read$/);

  // Open books sit below with their own add-voice page; invited ones do not.
  const openNow = page.getByTestId("open-now");
  await expect(openNow).toContainText(`Open ${stamp}`);
  await expect(openNow).not.toContainText(`Private ${stamp}`);
  await expect(openNow.getByRole("link", { name: /add your voice/i }).first()).toHaveAttribute("href", /\/b\/[^/]+\/voice$/);
  expect(await page.locator(`a[href="/b/${openBook.slug}/voice"]`).count()).toBeGreaterThan(0);

  // No private studio address (studio-<hash>) shows on public pages.
  for (const path of ["/", "/library"]) {
    await page.goto(path);
    expect(await page.content()).not.toMatch(/studio-[0-9a-f]{8,}/);
  }
});

test("reader of a released book plays the audiobook inline and offers downloads", async ({ page }) => {
  await page.goto("/library");
  const card = page.getByTestId("released-card").filter({ hasText: /Is AI making you smarter or lazier/i }).first();
  await card.getByRole("link", { name: "Read" }).click();
  await expect(page).toHaveURL(/\/b\/smarter-or-lazier\/read/);
  await page.getByRole("button", { name: "Listen" }).click();
  await expect(page.locator("audio.read-media__player")).toBeVisible();
  await expect(page.getByRole("link", { name: /download audio/i })).toHaveAttribute("href", /\/api\/media\/smarter-or-lazier\/audiobook/);
});

test("home shows the Library in the top bar and a released-books shelf", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("a.toplib")).toHaveAttribute("href", "/library");
  const shelf = page.getByTestId("released-shelf");
  await expect(shelf).toBeVisible();
  await expect(shelf.getByRole("link", { name: /library/i })).toHaveAttribute("href", "/library");
});
