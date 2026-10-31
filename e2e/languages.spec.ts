import { expect, test } from "@playwright/test";
import { BASE, signIn } from "./helpers";

const LINES = [
  "Night buses are the only place I can think. The city goes quiet and I finally hear my own thoughts on the night shift.",
  "On a night shift the hours stretch. I keep awake with tea, the radio, and the people who come in needing help at three in the morning.",
];

test("a Japanese book: its pages speak Japanese, and an English voice is put into Japanese", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, `ja-${Date.now()}@example.com`);
  const api = page.request;
  const created = await api.post("/api/books", {
    headers: { origin: BASE },
    data: { title: "夜の街", question: "What keeps you awake at night in the city?", type: "OPEN", coverVibe: "ember", closesAt: null, language: "ja", ai: { source: "demo" } },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const book = await created.json();

  await page.goto(`/b/${book.slug}/voice`);
  await expect(page.locator("html, [lang=ja]").last()).toHaveAttribute("lang", "ja");
  await expect(page.getByTestId("tab-speak")).not.toHaveText(/^Speak$/);

  const voice = await api.post(`/api/books/${book.id}/voices`, {
    headers: { origin: BASE },
    data: { text: LINES[0], mode: "speak", language: "en", name: "Night Owl", consent: true, metrics: { activeMs: 30_000, keys: 0, spoken: LINES[0].length } },
  });
  expect(voice.ok(), await voice.text()).toBeTruthy();
  const body = await voice.json();
  await page.goto(`/b/${book.slug}/voice/thanks?id=${body.id}`);
  await expect(page.getByText(LINES[0], { exact: true })).toBeVisible();
  // Demo mode marks the translation with [ja]; a live AI writes real Japanese.
  await expect(page.getByTestId("book-text")).toContainText("[ja]");
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}-thanks.png`, fullPage: true });
});

test("release in more languages: Studio translates the book and readers can switch", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, `langs-${Date.now()}@example.com`);
  const api = page.request;
  const created = await api.post("/api/books", {
    headers: { origin: BASE },
    data: { title: "Night shift notes", question: "What keeps you awake on a night shift?", type: "OPEN", coverVibe: "ember", closesAt: null, ai: { source: "demo" } },
  });
  const book = await created.json();
  for (const [index, line] of LINES.entries()) {
    const voice = await api.post(`/api/books/${book.id}/voices`, {
      headers: { origin: BASE },
      data: { text: line, mode: "write", name: `Speaker ${index + 1}`, consent: true, metrics: { activeMs: 30_000, keys: line.length, spoken: 0 } },
    });
    expect(voice.ok(), await voice.text()).toBeTruthy();
  }
  expect((await api.post(`/api/books/${book.id}/close`, { headers: { origin: BASE } })).ok()).toBeTruthy();
  await page.goto(`/studio/${book.slug}?tab=make`);
  await page.getByRole("button", { name: "Make the book", exact: true }).click();
  await expect(page.getByRole("link", { name: "Edit draft" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /^Publish v\d+$/ }).click();
  await expect(page.getByRole("link", { name: "Read the book" })).toBeVisible({ timeout: 90_000 });

  await page.goto(`/studio/${book.slug}?tab=release`);
  const box = page.getByTestId("release-languages");
  await expect(box).toBeVisible();
  await box.getByTestId("release-lang-add").selectOption("ja");
  await box.getByRole("button", { name: "Add" }).click();
  await expect(box.getByTestId("release-lang-ja")).toContainText("Ready", { timeout: 90_000 });
  if (process.env.SHOT) await box.screenshot({ path: `${process.env.SHOT}-release.png` });

  await page.goto(`/b/${book.slug}`);
  const sw = page.getByTestId("lang-switch").first();
  await expect(sw).toBeVisible();
  await sw.locator("summary").click();
  await sw.getByRole("link", { name: "日本語" }).click();
  await expect(page).toHaveURL(/lang=ja/);
  if (process.env.SHOT) {
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${process.env.SHOT}-book-ja.png` });
  }
  await expect(page.getByText(/\[ja\]/).first()).toBeVisible();
  await page.goto(`/b/${book.slug}/read?lang=ja`);
  await expect(page.locator("[lang=ja]").first()).toBeVisible();
  await expect(page.getByText(/\[ja\]/).first()).toBeVisible();
  // The original is still there.
  await page.goto(`/b/${book.slug}/read`);
  await expect(page.getByText(/\[ja\]/)).toHaveCount(0);
});
