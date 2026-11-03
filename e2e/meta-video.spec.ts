import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { BASE, signIn } from "./helpers";

const LINES = [
  "Night buses are the only place I can think. The city goes quiet and I finally hear my own thoughts.",
  "On a night shift the hours stretch. I keep awake with tea, the radio, and the people who come in at three in the morning.",
];

async function voices(api: APIRequestContext, origin: string, bookId: string) {
  for (const [index, line] of LINES.entries()) {
    const voice = await api.post(`/api/books/${bookId}/voices`, {
      headers: { origin },
      data: { text: line, mode: "speak", name: `Speaker ${index + 1}`, consent: true, metrics: { activeMs: 30_000, keys: 0, spoken: line.length } },
    });
    expect(voice.ok(), await voice.text()).toBeTruthy();
  }
}

async function checkFilm(page: Page, slug: string) {
  const film = await page.request.get(`/api/media/${slug}/video?download=1`);
  expect(film.ok()).toBeTruthy();
  const bytes = await film.body();
  expect(bytes.length).toBeGreaterThan(50_000);
  expect(bytes.subarray(4, 8).toString("latin1")).toBe("ftyp");
  // It plays in the browser, with sound, for about as long as the narration plus the end card.
  await page.goto(`/b/${slug}`);
  await page.getByRole("button", { name: /Play the film/ }).click();
  const video = page.locator("video.film__video");
  await expect(video).toBeVisible();
  const info = await video.evaluate(
    (element: HTMLVideoElement) =>
      new Promise<{ duration: number; width: number; height: number }>((resolve, reject) => {
        const done = () => resolve({ duration: element.duration, width: element.videoWidth, height: element.videoHeight });
        if (element.readyState >= 1) done();
        element.addEventListener("loadedmetadata", done, { once: true });
        element.addEventListener("error", () => reject(new Error("video error")), { once: true });
      }),
  );
  expect(info.width).toBe(1280);
  expect(info.height).toBe(720);
  expect(info.duration).toBeGreaterThan(8);
  return info;
}

test.describe("no model", () => {
  test.skip(Boolean(process.env.E2E_FAKE_META || process.env.E2E_REAL_META));
  test("Studio: make the Meta video book with styled cards, then watch it on the book page", async ({ page }) => {
    test.setTimeout(600_000);
    await signIn(page, `meta-video-${Date.now()}@example.com`);
    const api = page.request;
    const created = await api.post("/api/books", {
      headers: { origin: BASE },
      data: { title: "Night shift notes", question: "What keeps you awake on a night shift?", type: "OPEN", coverVibe: "ember", closesAt: null, ai: { source: "demo" } },
    });
    expect(created.ok()).toBeTruthy();
    const book = await created.json();
    await voices(api, BASE, book.id);
    expect((await api.post(`/api/books/${book.id}/close`, { headers: { origin: BASE } })).ok()).toBeTruthy();
    expect((await api.post(`/api/books/${book.id}/generate`, { headers: { origin: BASE }, timeout: 90_000 })).ok()).toBeTruthy();
    expect((await api.post(`/api/books/${book.id}/publish`, { headers: { origin: BASE }, timeout: 90_000 })).ok()).toBeTruthy();

    await page.goto(`/studio/${book.slug}?tab=release`);
    await expect(page.getByTestId("meta-video-images")).toContainText("No pictures (styled cards) · Recommended", { timeout: 30_000 });
    await expect(page.getByTestId("meta-video-voice")).toContainText("Meta");
    await page.getByTestId("meta-video-make").click();
    await expect(page.getByTestId("meta-video-done")).toBeVisible({ timeout: 540_000 });
    await expect(page.getByTestId("meta-video-done")).toContainText("styled cards");
    // The audiobook it narrated with is there too.
    await page.reload();
    await expect(page.getByTestId("meta-audio-en")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("meta-video-done")).toBeVisible();
    await page.getByTestId("meta-video-done").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/meta-video-cards-studio.png" });

    await checkFilm(page, book.slug);
    await expect(page.locator(".film__sub")).toContainText("Styled cards");
    await page.waitForTimeout(2500);
    await page.screenshot({ path: "test-results/meta-video-cards-book-page.png" });

    // Make again with nothing changed: no new work, the same film.
    const again = await api.post(`/api/books/${book.id}/media/meta/video`, { headers: { origin: BASE }, data: { action: "start" } });
    expect(again.ok(), await again.text()).toBeTruthy();
    const step = await (await api.post(`/api/books/${book.id}/media/meta/video`, { headers: { origin: BASE }, data: { action: "step" } })).json();
    expect(step.status).toBe("ready");

    // Only the owner can read the working files.
    const other = await page.context().browser()!.newContext({ baseURL: BASE });
    const asset = await other.request.get(`/api/books/${book.id}/media/meta/asset?key=book-${book.id}-mm-state.json`);
    expect(asset.status()).toBeGreaterThanOrEqual(401);
    await other.close();
  });
});

// Run with E2E_FAKE_META=1 E2E_BASE=<server whose META_API_BASE_URL points at the fake Meta server>.
test.describe("with Meta models", () => {
  // E2E_REAL_META=1: the second server has the real key in its own environment (AI_MODE=live); the test never sees it.
  test.skip(!process.env.E2E_FAKE_META && !process.env.E2E_REAL_META);
  test("Studio: Meta video book with Muse Spark scenes and Muse Image pictures (fake Meta server)", async ({ page, playwright }) => {
    test.setTimeout(900_000);
    const DEV = "http://localhost:43123";
    const email = `meta-video-${Date.now()}@example.com`;
    const dev = await playwright.request.newContext({ baseURL: DEV });
    const magic = await (await dev.post("/api/auth/magic", { data: { email }, headers: { origin: DEV } })).json();
    expect((await dev.get(magic.devLink as string)).ok()).toBeTruthy();
    const book = await (
      await dev.post("/api/books", {
        headers: { origin: DEV },
        data: { title: "Night shift notes", question: "What keeps you awake on a night shift?", type: "OPEN", coverVibe: "ember", closesAt: null, ai: { source: "demo" } },
      })
    ).json();
    await voices(dev, DEV, book.id);
    expect((await dev.post(`/api/books/${book.id}/close`, { headers: { origin: DEV } })).ok()).toBeTruthy();
    expect((await dev.post(`/api/books/${book.id}/generate`, { headers: { origin: DEV }, timeout: 90_000 })).ok()).toBeTruthy();
    expect((await dev.post(`/api/books/${book.id}/publish`, { headers: { origin: DEV }, timeout: 90_000 })).ok()).toBeTruthy();

    await signIn(page, email);
    const api = page.request;
    if (process.env.E2E_FAKE_META) {
      const keyed = await api.patch(`/api/books/${book.id}`, { headers: { origin: BASE }, data: { aiKey: "fake-meta-key-for-tests-0000" } });
      expect(keyed.ok(), await keyed.text()).toBeTruthy();
    }
    await page.goto(`/studio/${book.slug}?tab=release`);
    await expect(page.getByTestId("meta-video-writer")).toContainText("muse-spark-1.3 · Recommended", { timeout: 30_000 });
    await expect(page.getByTestId("meta-video-images")).toContainText("muse-image-1.0 · Recommended");
    await expect(page.getByText(/up to \d+ pictures/)).toBeVisible();
    await page.getByTestId("meta-video-make").click();
    await expect(page.getByTestId("meta-video-done")).toBeVisible({ timeout: 540_000 });
    await expect(page.getByTestId("meta-video-done")).toContainText(/\d+ pictures/);
    await expect(page.getByTestId("meta-video-done")).toContainText("Pictures: muse-image-1.0");
    await page.getByTestId("meta-video-done").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/meta-video-studio.png" });

    const panel = await (await api.get(`/api/books/${book.id}/media/meta/video`)).json();
    expect(JSON.stringify(panel)).not.toContain("fake-meta-key");
    expect(panel.video.pictures).toBeGreaterThan(0);

    // Change only the picture pick to styled cards: the scenes and the narration are reused.
    await page.getByTestId("meta-video-images").selectOption("none");
    await expect(page.getByText(/only the changed steps run again/)).toBeVisible();

    await checkFilm(page, book.slug);
    await expect(page.locator(".film__credit")).toContainText("Pictures: muse-image-1.0");
    // A frame from the middle of the film, for the report.
    await page.locator("video.film__video").evaluate((element: HTMLVideoElement) => {
      element.pause();
      element.currentTime = Math.min(element.duration - 1, 12);
    });
    await page.waitForTimeout(1500);
    await page.locator("video.film__video").screenshot({ path: "test-results/meta-video-frame.png" });
  });
});
