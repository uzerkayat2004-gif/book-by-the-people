import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BASE, signInRequest } from "./helpers";

const tone = path.join(process.cwd(), "e2e", "tone.wav");

async function newBook(request: import("@playwright/test").APIRequestContext, title: string) {
  const created = await request.post("/api/books", {
    headers: { origin: BASE },
    data: { title, question: `${title}: what did you learn?`, type: "OPEN", coverVibe: "ember", closesAt: null, ai: { source: "demo" } },
  });
  expect(created.ok()).toBeTruthy();
  return created.json();
}

test("Write only: no Speak tab, no microphone, About you first", async ({ page }) => {
  let askedMic = false;
  await page.exposeFunction("__askedMic", () => (askedMic = true));
  await page.addInitScript(() => {
    const md = navigator.mediaDevices;
    if (md) md.getUserMedia = () => ((window as unknown as { __askedMic: () => void }).__askedMic(), Promise.reject(new Error("no")));
  });
  await page.goto("/b/city-at-night/voice?guest=1");
  await expect(page.getByTestId("words")).toBeVisible();
  for (const id of ["mode-speak", "mode-write", "start-speaking", "speech-status"]) await expect(page.getByTestId(id)).toHaveCount(0);
  await expect(page.getByText(/Speak|microphone/)).toHaveCount(0);
  await expect(page.getByText(/up to about [\d,]+ words/)).toBeVisible();
  const labels = await page.locator("section.vf__card").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
  expect(labels).toEqual(["About you", "Your answer"]);
  expect(await page.locator("select#language option").count()).toBeGreaterThanOrEqual(30);
  await expect(page.locator("input[type=file]")).toHaveCount(0);
  expect(askedMic).toBe(false);
});

test("pasting and dropping are allowed, with no note", async ({ page }) => {
  await page.goto("/b/city-at-night/voice?guest=1");
  const box = page.getByTestId("words");
  await box.click();
  await page.keyboard.type("Typed by me.");
  const paste = await box.evaluate((node) => {
    const data = new DataTransfer();
    data.setData("text/plain", " Pasted");
    return node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  expect(paste).toBe(true);
  const long = "This whole answer was written somewhere else and pasted in at once, which is fine now.";
  await page.keyboard.press("End");
  await page.keyboard.insertText(` ${long}`);
  await expect(box).toHaveValue(`Typed by me. ${long}`);
  await expect(page.getByTestId("paste-note")).toHaveCount(0);
});

test("speech-to-text is off on the server", async ({ request }) => {
  const res = await request.post("/api/books/anything/transcribe", { headers: { origin: BASE, "content-type": "audio/wav" }, data: Buffer.from("RIFF") });
  expect(res.status()).toBe(410);
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
