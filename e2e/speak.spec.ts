import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BASE, signIn, signInRequest } from "./helpers";

const tone = path.join(process.cwd(), "e2e", "tone.wav");

test("speak page shows a random start word and 30 languages", async ({ page }) => {
  await signIn(page, `speaker-${Date.now()}@example.com`);
  await page.goto("/b/city-at-night/speak");
  await expect(page.getByTestId("start-word").first()).not.toHaveText("…");
  const options = await page.locator("select#language option").count();
  expect(options).toBeGreaterThanOrEqual(30);
});

test("a voice without its start word is not saved; one with it is", async ({ request }) => {
  await signInRequest(request, `skip-${Date.now()}@example.com`);
  const created = await request.post("/api/books", {
    headers: { origin: BASE },
    data: { title: "Gate check", question: "Will the start word hold the door?", type: "OPEN", coverVibe: "ember", closesAt: null },
  });
  expect(created.ok()).toBeTruthy();
  const book = await created.json();
  const audio = readFileSync(tone);
  const word = await (await request.post(`/api/books/${book.id}/challenge`, { headers: { origin: BASE }, data: { language: "es" } })).json();
  const refused = await request.post(`/api/books/${book.id}/voices`, {
    headers: { origin: BASE },
    multipart: {
      audio: { name: "tone.wav", mimeType: "audio/wav", buffer: audio },
      challengeId: word.challengeId,
      name: "Skip",
      consent: "true",
      durationMs: "2000",
      clientTranscript: "I never said the required word at all in this recording.",
    },
  });
  expect(refused.status()).toBe(422);
  const body = await refused.json();
  expect(body.code).toBe("start-word");
  expect(body.error).toMatch(/nothing was saved/i);

  const next = await (await request.post(`/api/books/${book.id}/challenge`, { headers: { origin: BASE }, data: { language: "en" } })).json();
  const accepted = await request.post(`/api/books/${book.id}/voices`, {
    headers: { origin: BASE },
    multipart: {
      audio: { name: "tone.wav", mimeType: "audio/wav", buffer: audio },
      challengeId: next.challengeId,
      name: "Skip",
      consent: "true",
      durationMs: "2000",
      clientTranscript: `${next.startWord}. Doors matter more than I thought, and the start word is how I knew I was heard.`,
    },
  });
  expect(accepted.ok()).toBeTruthy();
  const kept = await accepted.json();
  expect(["READY", "NEEDS_YOU"]).toContain(kept.status);
  expect((await request.get(`/api/audio/${kept.id}`)).ok()).toBeTruthy();
});
