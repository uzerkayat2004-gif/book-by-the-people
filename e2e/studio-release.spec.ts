import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BASE, signIn } from "./helpers";

const tone = readFileSync(path.join(process.cwd(), "e2e", "tone.wav"));

const LINES = [
  "Night buses are the only place I can think. The city goes quiet and I finally hear my own thoughts on the night shift.",
  "On a night shift the hours stretch. I keep awake with tea, the radio, and the people who come in needing help at three in the morning.",
];

test("Studio: voices in, make the book, release audiobook + video, read it", async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page, `release-${Date.now()}@example.com`);
  const api = page.request;
  const created = await api.post("/api/books", {
    headers: { origin: BASE },
    data: { title: "Night shift notes", question: "What keeps you awake on a night shift?", type: "OPEN", coverVibe: "ember", closesAt: null },
  });
  expect(created.ok()).toBeTruthy();
  const book = await created.json();
  for (const [index, line] of LINES.entries()) {
    const word = await (await api.post(`/api/books/${book.id}/challenge`, { headers: { origin: BASE }, data: { language: "en" } })).json();
    const voice = await api.post(`/api/books/${book.id}/voices`, {
      headers: { origin: BASE },
      multipart: {
        audio: { name: "tone.wav", mimeType: "audio/wav", buffer: tone },
        challengeId: word.challengeId,
        name: `Speaker ${index + 1}`,
        consent: "true",
        durationMs: "4000",
        clientTranscript: `${word.startWord}. ${line}`,
      },
    });
    expect(voice.ok(), await voice.text()).toBeTruthy();
  }
  expect((await api.post(`/api/books/${book.id}/close`, { headers: { origin: BASE } })).ok()).toBeTruthy();

  await page.goto(`/studio/${book.slug}?tab=make`);
  await page.getByRole("button", { name: "Make the book", exact: true }).click();
  await expect(page.getByRole("link", { name: "Edit draft" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /^Publish v\d+$/ }).click();
  await expect(page.getByRole("link", { name: "Read the book" })).toBeVisible({ timeout: 90_000 });

  // The audiobook and video are spoken in the background after Publish; Release shows them when done.
  await page.goto(`/studio/${book.slug}?tab=release`);
  await expect(page.getByText(/\.mp3/)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/\.mp4/)).toBeVisible();
  await expect(page.getByText("Emails to speakers are off.", { exact: false })).toBeVisible();

  const audio = await api.get(`/api/media/${book.slug}/audiobook?download=1`);
  expect(audio.ok()).toBeTruthy();
  expect((await audio.body()).length).toBeGreaterThan(5_000);
  const video = await api.get(`/api/media/${book.slug}/video?download=1`);
  expect(video.ok()).toBeTruthy();
  expect(video.headers()["content-type"]).toContain("video/mp4");

  await page.goto(`/b/${book.slug}/read`);
  await expect(page.getByTestId("quote-text").first()).toBeVisible();
  await expect(page.getByText(/people said/i)).toHaveCount(0);
});
