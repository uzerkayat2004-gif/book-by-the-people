import { expect, test } from "@playwright/test";
import { BASE, signIn } from "./helpers";

const LINES = [
  "Night buses are the only place I can think. The city goes quiet and I finally hear my own thoughts.",
  "On a night shift the hours stretch. I keep awake with tea, the radio, and the people who come in at three in the morning.",
];

test.describe("no model", () => {
  test.skip(Boolean(process.env.E2E_FAKE_META));
  test("Studio: make the Meta audiobook, then play it with chapters on the book page", async ({ page }) => {
  test.setTimeout(420_000);
  await signIn(page, `meta-audio-${Date.now()}@example.com`);
  const api = page.request;
  const created = await api.post("/api/books", {
    headers: { origin: BASE },
    data: { title: "Night shift notes", question: "What keeps you awake on a night shift?", type: "OPEN", coverVibe: "ember", closesAt: null, ai: { source: "demo" } },
  });
  expect(created.ok()).toBeTruthy();
  const book = await created.json();
  for (const [index, line] of LINES.entries()) {
    const voice = await api.post(`/api/books/${book.id}/voices`, {
      headers: { origin: BASE },
      data: { text: line, mode: "speak", name: `Speaker ${index + 1}`, consent: true, metrics: { activeMs: 30_000, keys: 0, spoken: line.length } },
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
  const make = page.getByTestId("meta-make");
  await expect(make).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("meta-voice-en")).toContainText("Meta");
  await make.click();
  await expect(page.getByTestId("meta-audio-en")).toBeVisible({ timeout: 360_000 });

  const audio = await api.get(`/api/media/${book.slug}/audiobook?download=1`);
  expect(audio.ok()).toBeTruthy();
  const bytes = await audio.body();
  expect(bytes.length).toBeGreaterThan(20_000);
  expect(bytes[0] === 0xff || bytes.subarray(0, 3).toString() === "ID3").toBeTruthy();

  // Pressing Make again with nothing changed keeps the same audiobook.
  const again = await api.post(`/api/books/${book.id}/media/meta`, { headers: { origin: BASE }, data: { action: "start" } });
  expect(again.ok(), await again.text()).toBeTruthy();

  await page.goto(`/b/${book.slug}`);
  await expect(page.getByTestId("audio-chapters")).toBeVisible();
  await expect(page.getByText(/Voice: Meta/)).toBeVisible();
});
});

// Run with E2E_FAKE_META=1 E2E_BASE=<server whose META_API_BASE_URL points at a fake Meta server>.
// The book is made on the dev server (mock AI) and then voiced on that second server, which shares its database.
test.describe("with the Meta writer", () => {
  test.skip(!process.env.E2E_FAKE_META);
  test("Studio: Meta audiobook written by muse-spark (fake Meta server)", async ({ page, playwright }) => {
    test.setTimeout(420_000);
    const DEV = "http://localhost:43123";
    const email = `meta-writer-${Date.now()}@example.com`;
    const dev = await playwright.request.newContext({ baseURL: DEV });
    const magic = await (await dev.post("/api/auth/magic", { data: { email }, headers: { origin: DEV } })).json();
    expect((await dev.get(magic.devLink as string)).ok()).toBeTruthy();
    const book = await (
      await dev.post("/api/books", {
        headers: { origin: DEV },
        data: { title: "Night shift notes", question: "What keeps you awake on a night shift?", type: "OPEN", coverVibe: "ember", closesAt: null, ai: { source: "demo" } },
      })
    ).json();
    for (const [index, line] of LINES.entries()) {
      const voice = await dev.post(`/api/books/${book.id}/voices`, {
        headers: { origin: DEV },
        data: { text: line, mode: "speak", name: `Speaker ${index + 1}`, consent: true, metrics: { activeMs: 30_000, keys: 0, spoken: line.length } },
      });
      expect(voice.ok(), await voice.text()).toBeTruthy();
    }
    expect((await dev.post(`/api/books/${book.id}/close`, { headers: { origin: DEV } })).ok()).toBeTruthy();
    const made = await dev.post(`/api/books/${book.id}/generate`, { headers: { origin: DEV }, timeout: 90_000 });
    expect(made.ok(), await made.text()).toBeTruthy();
    const published = await dev.post(`/api/books/${book.id}/publish`, { headers: { origin: DEV }, timeout: 90_000 });
    expect(published.ok(), await published.text()).toBeTruthy();

    await signIn(page, email);
    const api = page.request;
    // A pretend key for the fake server; it is sealed like a real one.
    const keyed = await api.patch(`/api/books/${book.id}`, { headers: { origin: BASE }, data: { aiKey: "fake-meta-key-for-tests-0000" } });
    expect(keyed.ok(), await keyed.text()).toBeTruthy();
    await page.goto(`/studio/${book.slug}?tab=release`);
    await expect(page.getByTestId("meta-writer")).toContainText("muse-spark-1.3 · Recommended", { timeout: 30_000 });
    await page.getByTestId("meta-make").click();
    await expect(page.getByTestId("meta-audio-en")).toBeVisible({ timeout: 360_000 });
    await page.getByTestId("meta-make").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/meta-audiobook-studio.png", fullPage: false });

    const panel = await (await api.get(`/api/books/${book.id}/media/meta`)).json();
    expect(JSON.stringify(panel)).not.toContain("fake-meta-key");
    await page.goto(`/b/${book.slug}`);
    await expect(page.getByTestId("audio-chapters")).toContainText("Night shift notes");
    await expect(page.getByText(/written by muse-spark-1.3/)).toBeVisible();
    await page.getByTestId("audio-chapters").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/meta-audiobook-book-page.png", fullPage: false });
  });
});
