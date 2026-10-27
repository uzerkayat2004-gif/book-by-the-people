import { expect, test } from "@playwright/test";

test("reader: plain prose, chapter nav, listen / watch / download for anyone", async ({ page, request }) => {
  await page.goto("/b/smarter-or-lazier/read");
  await expect(page.locator(".read3__title")).toBeVisible();
  await expect(page.getByText(/Chapter 1/).first()).toBeVisible();
  await expect(page.getByText(/\d+ people said/i)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Listen" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Watch" })).toBeVisible();
  // Signed out: media still downloads.
  const audio = await request.get("/api/media/smarter-or-lazier/audiobook?download=1");
  expect(audio.ok()).toBeTruthy();
  expect(audio.headers()["content-disposition"] ?? "").toMatch(/attachment/);
  const video = await request.get("/api/media/smarter-or-lazier/video?download=1");
  expect(video.ok()).toBeTruthy();
});

test("famous book shows real sources and dates, and no voice play button", async ({ page }) => {
  await page.goto("/b/on-the-record/read");
  const source = page.getByRole("link", { name: "Source" }).first();
  await expect(source).toHaveAttribute("href", /^https?:\/\//);
  await expect(page.locator("audio")).toHaveCount(0);
});

for (const [name, path, text] of [
  ["home", "/", /add your voice|the book is here|book by/i],
  ["book page", "/b/city-at-night", /city/i],
  ["explore", "/explore", /explore/i],
  ["404", "/no-such-page", /not found/i],
] as const) {
  test(`page renders: ${name}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByText(text).first()).toBeVisible();
  });
}
