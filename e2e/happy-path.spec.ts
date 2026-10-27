import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const tone = path.join(process.cwd(), "e2e", "tone.wav");

test("open book: upload a voice, make the book, publish, and play it", async ({ page }) => {
  test.setTimeout(90_000);
  const email = `maker-${Date.now()}@example.com`;
  await page.goto("/sign-in?next=/studio");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await page.getByRole("link", { name: "Open the magic link" }).click();
  await expect(page.getByRole("heading", { name: "Studio" })).toBeVisible();

  await page.getByRole("link", { name: "New book" }).click();
  await page.getByLabel("Title").fill("Night shift notes");
  await page.getByLabel("Question or topic").fill("What keeps you awake on a night shift?");
  await page.getByRole("radio", { name: "Open" }).check({ force: true });
  await page.getByRole("button", { name: "Create the book" }).click();
  await expect(page.getByRole("heading", { name: "Night shift notes" })).toBeVisible();

  await page.getByRole("link", { name: "Add a voice" }).click();
  await expect(page.getByTestId("start-word")).not.toHaveText("…");
  await page.getByLabel("Name in the book").fill("Nia");
  await page.getByTestId("consent").click();
  await page.getByTestId("audio-file").setInputFiles(tone);
  await page.getByRole("button", { name: "Add this voice" }).click();
  await expect(page.getByRole("heading", { name: "Sealed." })).toBeVisible();

  await page.getByRole("link", { name: "Studio" }).click();
  await page.getByRole("link", { name: "Night shift notes" }).click();
  await page.getByRole("button", { name: "Close voices" }).click();
  await expect(page.getByText("Off — voices are closed")).toBeVisible();
  await page.getByRole("link", { name: "Make the book" }).click();
  await page.getByRole("button", { name: "Make the book" }).click();
  await expect(page.getByRole("link", { name: "Edit the draft" })).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("link", { name: "Read" })).toBeVisible();
  await page.getByRole("link", { name: "Read" }).click();
  await expect(page.getByTestId("quote-text").first()).toBeVisible();
  await expect(page.getByText(/people said/i)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Listen" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Watch" })).toBeVisible();
  await page.getByTestId("play-quote").first().click();
  await expect(page.locator("audio").first()).toBeAttached();
});

test("famous voices stay sourced and have no play button", async ({ page }) => {
  test.setTimeout(90_000);
  const email = `editor-${Date.now()}@example.com`;
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await page.getByRole("link", { name: "Open the magic link" }).click();
  await page.getByRole("link", { name: "New book" }).click();
  await page.getByRole("radio", { name: "Famous voices" }).check({ force: true });
  await page.getByLabel("Title").fill("Lines on the record");
  await page.getByLabel("Question or topic").fill("What did they say in public about machines?");
  await page.getByRole("button", { name: "Create the book" }).click();
  await page.getByPlaceholder("Who said it").fill("Ada Lovelace");
  await page
    .getByPlaceholder("The quotation, verbatim")
    .fill("The Analytical Engine weaves algebraical patterns just as the Jacquard loom weaves flowers and leaves.");
  await page.getByPlaceholder("https://source.example/article").fill("https://en.wikipedia.org/wiki/Ada_Lovelace");
  await page.getByRole("button", { name: "Add quote" }).click();
  await expect(page.getByText("Ada Lovelace")).toBeVisible();
  await page.getByRole("link", { name: "Make the book" }).click();
  await page.getByRole("button", { name: "Make the book" }).click();
  await expect(page.getByRole("link", { name: "Edit the draft" })).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await page.getByRole("link", { name: "Read" }).click();
  await expect(page.getByRole("link", { name: "Source" })).toHaveAttribute("href", /wikipedia/);
  await expect(page.getByTestId("play-quote")).toHaveCount(0);
});

test("a missing start word is not saved", async ({ request }) => {
  const email = `skip-${Date.now()}@example.com`;
  const magic = await request.post("/api/auth/magic", { data: { email } });
  const body = await magic.json();
  const devLink = body.devLink as string;
  const origin = new URL(devLink).origin;
  const verify = await request.get(devLink);
  expect(verify.ok()).toBeTruthy();

  const created = await request.post(`${origin}/api/books`, {
    data: {
      title: "Gate check",
      question: "Will the start word hold the door?",
      type: "OPEN",
      coverVibe: "ember",
      closesAt: null,
    },
  });
  expect(created.ok()).toBeTruthy();
  const book = await created.json();
  const challenge = await request.post(`${origin}/api/books/${book.id}/challenge`, { data: { language: "es" } });
  const word = await challenge.json();
  const audio = readFileSync(tone);
  const response = await request.post(`${origin}/api/books/${book.id}/voices`, {
    multipart: {
      audio: { name: "tone.wav", mimeType: "audio/wav", buffer: audio },
      challengeId: word.challengeId,
      name: "Skip",
      consent: "true",
      durationMs: "2000",
      clientTranscript: "I never said the required word at all in this recording.",
    },
  });
  expect(response.status()).toBe(422);
  const saved = await response.json();
  expect(saved.id).toBeUndefined();
  expect(saved.code).toBe("start-word");
  expect(saved.error).toMatch(/nothing was saved/i);
  expect(saved.error).toContain(word.startWord);

  const again = await request.post(`${origin}/api/books/${book.id}/voices`, {
    multipart: {
      audio: { name: "tone.wav", mimeType: "audio/wav", buffer: audio },
      challengeId: word.challengeId,
      name: "Skip",
      consent: "true",
      durationMs: "2000",
      clientTranscript: `${word.startWord}. Now I say the word after it was already refused.`,
    },
  });
  expect(again.ok()).toBeFalsy();

  const fresh = await request.post(`${origin}/api/books/${book.id}/challenge`, { data: { language: "en" } });
  const nextWord = await fresh.json();
  const accepted = await request.post(`${origin}/api/books/${book.id}/voices`, {
    multipart: {
      audio: { name: "tone.wav", mimeType: "audio/wav", buffer: audio },
      challengeId: nextWord.challengeId,
      name: "Skip",
      consent: "true",
      durationMs: "2000",
      clientTranscript: `${nextWord.startWord}. The night shift is quiet and I keep thinking.`,
    },
  });
  expect(accepted.ok()).toBeTruthy();
  const kept = await accepted.json();
  expect(kept.status).toBe("READY");
  const audioResponse = await request.get(`${origin}/api/audio/${kept.id}`);
  expect(audioResponse.ok()).toBeTruthy();
});
