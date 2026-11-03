import { expect, test } from "@playwright/test";
import { BASE, signIn } from "./helpers";

const LINES = [
  "Night buses are the only place I can think. The city goes quiet and I finally hear my own thoughts on the night shift.",
  "On a night shift the hours stretch. I keep awake with tea, the radio, and the people who come in needing help at three in the morning.",
];

// Matches the dev server's HACKATHON_META_ONLY (on unless set to 0).
const META_ONLY = !["0", "false", "off", "no"].includes((process.env.HACKATHON_META_ONLY ?? "1").trim().toLowerCase());

test("Studio: voices in, make the book, release audiobook + video, read it", async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page, `release-${Date.now()}@example.com`);
  const api = page.request;
  const created = await api.post("/api/books", {
    headers: { origin: BASE },
    data: { title: "Night shift notes", question: "What keeps you awake on a night shift?", type: "OPEN", coverVibe: "ember", closesAt: null, ai: { source: "demo" }, releaseLanguages: ["hi"] },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const book = await created.json();
  for (const [index, line] of LINES.entries()) {
    const voice = await api.post(`/api/books/${book.id}/voices`, {
      headers: { origin: BASE },
      data: {
        text: line,
        mode: "speak",
        name: `Speaker ${index + 1}`,
        consent: true,
        metrics: { activeMs: 30_000, keys: 0, spoken: line.length },
      },
    });
    expect(voice.ok(), await voice.text()).toBeTruthy();
  }
  expect((await api.post(`/api/books/${book.id}/close`, { headers: { origin: BASE } })).ok()).toBeTruthy();

  if (META_ONLY) {
    // Before release: the Meta cards are there, greyed out, and say when they unlock; uploads are the second choice.
    await page.goto(`/studio/${book.slug}?tab=release`);
    await expect(page.getByTestId("meta-audiobook-locked")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("meta-video-locked")).toBeVisible();
    await expect(page.getByTestId("meta-make")).toBeDisabled();
    await expect(page.getByTestId("meta-make")).toHaveText("Unlocks after Publish");
    await expect(page.getByTestId("meta-video-make")).toBeDisabled();
    await expect(page.getByTestId("meta-video-writer")).toBeDisabled();
    await expect(page.getByTestId("meta-video-images")).toBeDisabled();
    // The voice pickers cover the release language picked on the New book form.
    await expect(page.getByTestId("meta-voice-en")).toBeVisible();
    await expect(page.getByTestId("meta-voice-hi")).toBeVisible();
    await expect(page.getByText("eSpeak")).toHaveCount(0);
    const own = page.getByTestId("media-own");
    await expect(own).toBeVisible();
    await expect(own.getByText("MP3 or WAV")).toBeHidden();
    await own.locator("summary").click();
    await expect(own.getByText("MP3 or WAV")).toBeVisible();
    // Order: Meta audiobook, Meta video book, then the upload choice.
    const order = await page.locator("[data-testid='meta-audiobook'], [data-testid='meta-video'], [data-testid='media-own']").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")));
    expect(order).toEqual(["meta-audiobook", "meta-video", "media-own"]);
    await page.getByTestId("meta-video").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/release-before-publish.png", fullPage: true });
  }

  await page.goto(`/studio/${book.slug}?tab=make`);
  await page.getByRole("button", { name: "Make the book", exact: true }).click();
  await expect(page.getByRole("link", { name: "Edit draft" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /^Publish v\d+$/ }).click();
  await expect(page.getByRole("link", { name: "Read the book" })).toBeVisible({ timeout: 90_000 });

  await page.goto(`/studio/${book.slug}?tab=release`);
  await expect(page.getByText("Emails to speakers are off.", { exact: false })).toBeVisible();
  if (META_ONLY) {
    // Meta-only (the hackathon default): nothing is spoken by the built-in voice; Release offers the Meta audiobook and video book.
    await expect(page.getByTestId("meta-make")).toBeEnabled({ timeout: 30_000 });
    await expect(page.getByTestId("meta-make")).toHaveText("Make audiobook");
    await expect(page.getByTestId("meta-video-make")).toBeEnabled();
    await expect(page.getByTestId("meta-audiobook-locked")).toHaveCount(0);
    await expect(page.getByTestId("media-own")).toBeVisible();
    await page.screenshot({ path: "test-results/release-after-publish.png", fullPage: true });
    await page.waitForTimeout(3000);
    expect((await api.get(`/api/media/${book.slug}/audiobook?download=1`)).status()).toBe(404);
    expect((await api.get(`/api/media/${book.slug}/video?download=1`)).status()).toBe(404);
  } else {
    // The audiobook and video are spoken in the background after Publish; Release shows them when done.
    await expect(page.getByText(/\.mp3/)).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/\.mp4/)).toBeVisible();
    const audio = await api.get(`/api/media/${book.slug}/audiobook?download=1`);
    expect(audio.ok()).toBeTruthy();
    expect((await audio.body()).length).toBeGreaterThan(5_000);
    const video = await api.get(`/api/media/${book.slug}/video?download=1`);
    expect(video.ok()).toBeTruthy();
    expect(video.headers()["content-type"]).toContain("video/mp4");
  }

  await page.goto(`/b/${book.slug}/read`);
  await expect(page.getByTestId("quote-text").first()).toBeVisible();
  await expect(page.getByText(/people said/i)).toHaveCount(0);
});
