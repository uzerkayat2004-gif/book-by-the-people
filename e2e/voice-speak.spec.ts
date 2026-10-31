import { expect, test, type Page } from "@playwright/test";

/**
 * Speak, end to end, with a fake microphone playing a recorded sample (see the speak-* projects in
 * playwright.config.ts). The real Whisper Base model runs in the browser.
 */
type Voice = { phase: string; note: string; problem: string; chunks: { sec: number; ms: number }[]; pending: number };
const voice = (page: Page) => page.evaluate(() => (window as unknown as { __voice: Voice }).__voice);

async function speak(page: Page, language: string, seconds: number) {
  const { noIsolation } = test.info().project.metadata as { noIsolation?: boolean };
  if (noIsolation) {
    // Like iPhone Safari: the isolation headers don't take, so the model runs on one thread.
    await page.route("**/b/gate-check/voice?guest=1&preload=1", async (route) => {
      const response = await route.fetch();
      const headers = { ...response.headers() };
      delete headers["cross-origin-embedder-policy"];
      delete headers["cross-origin-opener-policy"];
      await route.fulfill({ response, headers });
    });
    await page.addInitScript(() => sessionStorage.setItem("bbtp:coi", String(Date.now())));
  }
  await page.goto("/b/gate-check/voice?guest=1&preload=1");
  await expect(page.getByTestId("tab-speak")).toHaveAttribute("aria-selected", "true");
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(!noIsolation);
  await page.getByTestId("voice-language").selectOption(language);
  const micButton = page.getByTestId("mic");
  // The model gets ready by itself as soon as the Speak tab shows; the mic waits until it truly is.
  await expect.poll(async () => (await voice(page)).phase, { timeout: 30_000 }).toMatch(/downloading|preparing|idle/);
  if ((await voice(page)).phase !== "idle") await expect(micButton).toBeDisabled();
  await expect(micButton).toBeEnabled({ timeout: 240_000 });
  await expect(page.getByTestId("mic-state")).toHaveText(/Ready|तैयार|準備完了/);
  await micButton.click();
  // Ready means ready: listening starts at once and says so.
  await expect.poll(async () => (await voice(page)).phase, { timeout: 10_000 }).toBe("listening");
  await expect(page.getByTestId("wave")).toBeVisible();
  const started = Date.now();
  // Words arrive while still listening.
  await expect(page.getByTestId("words")).not.toHaveValue("", { timeout: 30_000 });
  const firstWords = Date.now() - started;
  await page.waitForTimeout(Math.max(0, seconds * 1000 - (Date.now() - started)));
  const stopped = Date.now();
  await micButton.click();
  await expect.poll(async () => (await voice(page)).phase, { timeout: 60_000 }).toBe("idle");
  const afterStop = Date.now() - stopped;
  const state = await voice(page);
  expect(state.problem).toBeFalsy();
  const info = await page.evaluate(() => (window as unknown as { __voice: { info?: { threads?: number } } }).__voice.info);
  if (noIsolation) expect(info?.threads).toBe(1);
  const text = await page.getByTestId("words").inputValue();
  console.log(`[${test.info().project.name}] first words ${firstWords} ms, stop→done ${afterStop} ms, chunks ${JSON.stringify(state.chunks)}\n${text.slice(0, 400)}`);
  return { text, afterStop };
}

test("speak, see the words, edit them, and send", async ({ page }) => {
  test.setTimeout(360_000);
  const { lang, phone } = test.info().project.metadata as { lang: string; phone: boolean };
  const { text, afterStop } = await speak(page, lang, 14);
  expect(afterStop).toBeLessThan(phone ? 10_000 : 8_000);

  if (lang === "en") {
    expect(text.split(/\s+/).length).toBeGreaterThan(8);
    expect(text).toMatch(/[a-z]{3,}/i);
  }
  if (lang === "hi") {
    const letters = text.replace(/[\s\p{P}\p{N}]/gu, "");
    expect(letters.length).toBeGreaterThan(10);
    expect(letters).toMatch(/^[\u0900-\u097F]+$/u);
  }
  if (lang === "ja") expect(text).toMatch(/[\u3040-\u30FF\u4E00-\u9FFF]{6,}/u);

  if (phone) {
    // Start again, then hide the page: it stops on its own and keeps the words.
    await page.getByTestId("mic").click();
    await expect.poll(async () => (await voice(page)).phase, { timeout: 30_000 }).toBe("listening");
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(async () => (await voice(page)).phase, { timeout: 60_000 }).toBe("idle");
    await expect(page.getByTestId("speak-note")).toBeVisible();
    await expect(page.getByTestId("words")).not.toHaveValue("");
    return;
  }
  if (lang !== "en") return;
  // The words stay editable, and they send.
  await page.getByTestId("words").press("End");
  await page.keyboard.type(" Edited.");
  await expect(page.getByTestId("words")).toHaveValue(/Edited\.$/);
  await page.locator("#name").fill("Mic Tester");
  await page.getByTestId("consent").check();
  await page.getByTestId("send-words").click();
  await expect(page).toHaveURL(/\/voice\/thanks\?id=/, { timeout: 60_000 });
});

test("a stuck start on several threads quietly restarts Whisper on one thread", async ({ page }) => {
  test.skip(test.info().project.name !== "speak-en", "once is enough");
  test.setTimeout(240_000);
  // Make the fast (multi-thread) setting hang while getting ready, like the Windows laptop report.
  await page.route("**/voice/whisper.worker.js", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      'post({ type: "status", stage: "warming", device });',
      'post({ type: "status", stage: "warming", device }); if (env.backends.onnx.wasm.numThreads > 1) await new Promise(() => {});',
    );
    await route.fulfill({ response, body });
  });
  await page.addInitScript(() => localStorage.removeItem("bbtp:voice-safe"));
  const started = Date.now();
  await page.goto("/b/gate-check/voice?guest=1&debug=1&preload=1");
  await expect(page.getByTestId("prep-sub")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("mic")).toBeDisabled();
  await expect(page.getByTestId("mic")).toBeEnabled({ timeout: 180_000 });
  const took = Date.now() - started;
  await page.getByTestId("mic").click();
  await expect.poll(async () => (await voice(page)).phase, { timeout: 10_000 }).toBe("listening");
  const info = await page.evaluate(() => (window as unknown as { __voice: { info?: { threads?: number } } }).__voice.info);
  expect(info?.threads).toBe(1);
  await expect(page.getByTestId("voice-diag")).toContainText("one-thread mode");
  expect(await page.evaluate(() => localStorage.getItem("bbtp:voice-safe"))).toBeTruthy();
  await expect(page.getByTestId("words")).not.toHaveValue("", { timeout: 30_000 });
  console.log(`[watchdog] listening after ${took} ms; diag: ${await page.getByTestId("voice-diag").innerText()}`);
  await page.getByTestId("mic").click();
  await expect.poll(async () => (await voice(page)).phase, { timeout: 60_000 }).toBe("idle");
  await page.evaluate(() => localStorage.removeItem("bbtp:voice-safe"));
});

test("tapped before the model was ready: it says wait, keeps what was said, then says start speaking", async ({ page }) => {
  test.skip(test.info().project.name !== "speak-en", "once is enough");
  test.setTimeout(300_000);
  // Data saver on and nothing downloaded yet: the model does not load before the tap.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true });
  });
  await page.goto("/b/gate-check/voice?guest=1");
  await expect(page.getByTestId("mic")).toBeEnabled({ timeout: 30_000 });
  if ((await voice(page)).phase !== "idle") test.skip(true, "model already loading");
  await page.getByTestId("mic").click();
  await expect(page.locator("[data-testid=warming], [data-testid=download-bar]").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("listen-label")).toHaveCount(0);
  await expect.poll(async () => (await voice(page)).phase, { timeout: 240_000 }).toBe("listening");
  await expect(page.getByTestId("wave")).toBeVisible();
  // Speech heard during the warm-up is written too.
  await expect(page.getByTestId("words")).not.toHaveValue("", { timeout: 30_000 });
  await page.getByTestId("mic").click();
  await expect.poll(async () => (await voice(page)).phase, { timeout: 60_000 }).toBe("idle");
  console.log(`[tap-early] ${(await page.getByTestId("words").inputValue()).slice(0, 200)}`);
});
