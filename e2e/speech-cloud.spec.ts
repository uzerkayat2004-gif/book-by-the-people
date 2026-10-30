import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * Speak with the book creator's speech model: the fake microphone plays a spoken wav (espeak),
 * the page cuts it into clips at pauses and posts each as WAV. The transcription route is mocked
 * (no provider key here) and answers clips in order.
 */
const speech = path.join(process.cwd(), "e2e", "speech.wav");
test.use({
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${speech}%noloop`, "--autoplay-policy=no-user-gesture-required"],
  },
  permissions: ["microphone"],
});

const LINES = ["My first job was at a tea stall near the station.", "it taught me to listen before I speak."];

async function mockTranscribe(page: Page, delayMs = 600) {
  const seen: { type: string; riff: string; rate: number; bytes: number; url: string }[] = [];
  await page.route("**/api/books/*/transcribe**", async (route) => {
    const body = route.request().postDataBuffer() ?? Buffer.alloc(0);
    seen.push({
      type: route.request().headers()["content-type"] ?? "",
      riff: body.subarray(0, 4).toString("ascii"),
      rate: body.length > 28 ? body.readUInt32LE(24) : 0,
      bytes: body.length,
      url: route.request().url(),
    });
    const index = seen.length - 1;
    await new Promise((done) => setTimeout(done, delayMs));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: LINES[index] ?? "" }) });
  });
  return seen;
}

test("cloud Speak: clips cut at pauses become words, in order, and no Web Speech is used", async ({ page }) => {
  await page.addInitScript(() => {
    class Boom {
      constructor() {
        throw new Error("Web Speech must not be used when the book has a speech model");
      }
    }
    Object.assign(window, { SpeechRecognition: Boom, webkitSpeechRecognition: Boom });
  });
  const seen = await mockTranscribe(page);
  await page.goto("/b/city-at-night/voice?guest=1&speech=cloud");
  await page.getByTestId("mode-speak").click();
  await expect(page.getByTestId("speech-status")).toHaveAttribute("data-state", "idle");
  await expect(page.getByTestId("start-speaking")).toBeVisible();
  await expect(page.getByText("Tap to speak", { exact: true })).toBeVisible();
  await expect(page.getByText("Your words will appear here. We never keep your audio.")).toBeVisible();
  await page.getByTestId("start-speaking").click();
  await expect(page.getByTestId("speech-status")).toHaveAttribute("data-state", "recording");
  await expect(page.getByTestId("level")).toBeVisible();
  await expect(page.getByTestId("words")).toHaveValue(LINES[0], { timeout: 15_000 });
  await expect(page.getByTestId("words")).toHaveValue(`${LINES[0]} It taught me to listen before I speak.`, { timeout: 15_000 });
  await page.getByTestId("stop-speaking").click();
  await expect(page.getByTestId("speech-status")).toHaveAttribute("data-state", "idle", { timeout: 10_000 });
  const lang = await page.locator("select#language").inputValue();
  expect(seen.length).toBeGreaterThanOrEqual(2);
  for (const clip of seen) {
    expect(clip.type).toBe("audio/wav");
    expect(clip.riff).toBe("RIFF");
    expect(clip.rate).toBe(16000);
    expect(clip.bytes).toBeLessThan(44 + 16000 * 2 * 16);
    expect(new URL(clip.url).searchParams.get("lang")).toBe(lang);
  }
});

test("cloud Speak keeps the person's own edits and adds new words at the end", async ({ page }) => {
  await mockTranscribe(page, 300);
  await page.goto("/b/city-at-night/voice?guest=1&speech=cloud");
  await page.getByTestId("mode-speak").click();
  const box = page.getByTestId("words");
  await box.click();
  await page.keyboard.type("Hello.");
  await page.getByTestId("start-speaking").click();
  await expect(box).toHaveValue(`Hello. ${LINES[0]}`, { timeout: 15_000 });
  await page.getByTestId("stop-speaking").click();
});

test("cloud Speak with no speech model falls back to the browser's speech-to-text", async ({ page }) => {
  await page.route("**/api/books/*/transcribe**", (route) =>
    route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "No speech model.", code: "no-speech" }) }),
  );
  await page.goto("/b/city-at-night/voice?guest=1&speech=cloud");
  await page.getByTestId("mode-speak").click();
  await page.getByTestId("start-speaking").click();
  await expect(page.getByTestId("paste-note")).toHaveText(/browser's speech-to-text/i, { timeout: 15_000 });
  await expect(page.getByTestId("start-speaking")).toBeVisible();
});

test("mic blocked: a clear message next to the button and a way to Write", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
  });
  await page.goto("/b/city-at-night/voice?guest=1&speech=cloud");
  await page.getByTestId("mode-speak").click();
  await page.getByTestId("start-speaking").click();
  await expect(page.getByTestId("mic-error")).toContainText(/Microphone access is blocked/);
  await page.getByRole("button", { name: "Use Write instead" }).click();
  await expect(page.getByTestId("mode-write")).toHaveClass(/on/);
});

test("speech model failing twice: stops, says so, and falls back to the browser", async ({ page }) => {
  await page.route("**/api/books/*/transcribe**", (route) =>
    route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "Could not turn that part into words.", code: "provider" }) }),
  );
  await page.goto("/b/city-at-night/voice?guest=1&speech=cloud");
  await page.getByTestId("mode-speak").click();
  await page.getByTestId("start-speaking").click();
  await expect(page.getByTestId("mic-error")).toContainText(/having trouble/, { timeout: 20_000 });
  await expect(page.getByTestId("start-speaking")).toBeVisible();
});

test("About you comes before Speak/Write", async ({ page }) => {
  await page.goto("/b/city-at-night/voice?guest=1");
  const labels = await page.locator("section.vf__card").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
  expect(labels.indexOf("About you")).toBeLessThan(labels.indexOf("Your answer"));
});

test("screenshots: idle, recording, processing, done", async ({ page }) => {
  test.skip(!process.env.SHOTS, "set SHOTS=1 to save screenshots");
  test.setTimeout(120_000);
  await mockTranscribe(page, 2500);
  for (const [w, h] of [[390, 844], [1280, 800]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/b/city-at-night/voice?guest=1&speech=cloud");
    await page.getByTestId("mode-speak").click();
    const card = page.getByTestId("speech-status");
    await card.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -120));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `/workspace/shots/v8/${w}-1-idle.png` });
    await page.getByTestId("start-speaking").click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `/workspace/shots/v8/${w}-2-recording.png` });
    await expect(page.getByTestId("speech-processing")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("stop-speaking").click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `/workspace/shots/v8/${w}-3-processing.png` });
    await expect(page.getByTestId("speech-processing")).toHaveCount(0, { timeout: 20_000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `/workspace/shots/v8/${w}-4-done.png` });
    await page.unroute("**/api/books/*/transcribe**");
    await mockTranscribe(page, 2500);
  }
});
