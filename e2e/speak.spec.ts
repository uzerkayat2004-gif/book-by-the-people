import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BASE, signInRequest } from "./helpers";

const tone = path.join(process.cwd(), "e2e", "tone.wav");

/** A stand-in for the browser's speech-to-text: interim words, then the final phrase. */
function mockSpeech() {
  class FakeRecognition {
    continuous = false;
    interimResults = false;
    lang = "";
    onresult: ((event: unknown) => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    start() {
      (window as unknown as { __lang: string }).__lang = this.lang;
      const fire = (list: [string, boolean][], index: number) =>
        this.onresult?.({ resultIndex: index, results: list.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal })) });
      setTimeout(() => fire([["My first job taught me", false]], 0), 100);
      setTimeout(() => fire([["My first job taught me to listen before I speak.", true]], 0), 300);
    }
    stop() {
      setTimeout(() => this.onend?.(), 10);
    }
    abort() {
      this.stop();
    }
  }
  Object.assign(window, { SpeechRecognition: FakeRecognition, webkitSpeechRecognition: FakeRecognition });
}

async function newBook(request: import("@playwright/test").APIRequestContext, title: string) {
  const created = await request.post("/api/books", {
    headers: { origin: BASE },
    data: { title, question: `${title}: what did you learn?`, type: "OPEN", coverVibe: "ember", closesAt: null, ai: { source: "demo" } },
  });
  expect(created.ok()).toBeTruthy();
  return created.json();
}

test("Speak turns live speech into words in the box; no start word, no audio", async ({ page }) => {
  await page.addInitScript(mockSpeech);
  await page.goto("/b/city-at-night/voice?guest=1");
  await expect(page.getByTestId("mode-speak")).toHaveClass(/on/);
  expect(await page.locator("select#language option").count()).toBeGreaterThanOrEqual(30);
  await expect(page.getByTestId("start-word")).toHaveCount(0);
  await expect(page.locator("input[type=file]")).toHaveCount(0);
  await page.getByTestId("start-speaking").click();
  await expect(page.getByTestId("words")).toHaveValue("My first job taught me to listen before I speak.");
  expect(await page.evaluate(() => (window as unknown as { __lang: string }).__lang)).toMatch(/^[a-z]{2,3}-[A-Z]{2}$/);
  await page.getByTestId("stop-speaking").click();
  await expect(page.getByTestId("words")).toHaveValue("My first job taught me to listen before I speak.");
});

test("Write blocks pasting and says why", async ({ page }) => {
  await page.goto("/b/city-at-night/voice?guest=1");
  await page.getByTestId("mode-write").click();
  const box = page.getByTestId("words");
  await box.click();
  await page.keyboard.type("Typed by me.");
  await box.evaluate((node) => {
    const data = new DataTransfer();
    data.setData("text/plain", "Pasted from somewhere else");
    node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(box).toHaveValue("Typed by me.");
  await expect(page.getByTestId("paste-note")).toHaveText(/pasting is off/i);
});

test("no speech-to-text in the browser: a clear note, and Write still works", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "SpeechRecognition", { value: undefined, configurable: true });
    Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined, configurable: true });
  });
  await page.goto("/b/city-at-night/voice?guest=1");
  await expect(page.getByTestId("speech-unsupported")).toBeVisible();
  await expect(page.getByTestId("mode-write")).toHaveClass(/on/);
});

test("voices are words only: uploads are refused, start words are gone, text is kept", async ({ request }) => {
  await signInRequest(request, `words-${Date.now()}@example.com`);
  const book = await newBook(request, "Words only");
  expect((await request.post(`/api/books/${book.id}/challenge`, { headers: { origin: BASE }, data: { language: "en" } })).status()).toBe(410);
  const upload = await request.post(`/api/books/${book.id}/voices`, {
    headers: { origin: BASE },
    multipart: { audio: { name: "tone.wav", mimeType: "audio/wav", buffer: readFileSync(tone) }, name: "Up", consent: "true" },
  });
  expect(upload.status()).toBe(415);
  const text = "Doors matter more than I thought. I learned that the hard way, on my first day.";
  const kept = await request.post(`/api/books/${book.id}/voices`, {
    headers: { origin: BASE },
    data: { text, mode: "write", name: "Writer", consent: true, metrics: { activeMs: 40_000, keys: text.length, spoken: 0 } },
  });
  expect(kept.ok(), await kept.text()).toBeTruthy();
  const body = await kept.json();
  expect(["READY", "NEEDS_YOU"]).toContain(body.status);
  expect((await request.get(`/api/audio/${body.id}`)).ok()).toBeFalsy();
});
