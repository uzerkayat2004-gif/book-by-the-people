import { expect, test } from "@playwright/test";

test("a blocked mic says so kindly and offers Write", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
  });
  await page.goto("/b/gate-check/voice?guest=1");
  await expect(page.getByTestId("tab-speak")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("mic")).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId("mic").click();
  await expect(page.getByTestId("speak-error")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("speak-error").getByRole("button").click();
  await expect(page.getByTestId("tab-write")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("words")).toBeEditable();
});

test("no speech support: Speak still shows, a tap explains and offers Write", async ({ page }) => {
  await page.addInitScript(() => {
    delete (globalThis as unknown as { WebAssembly?: unknown }).WebAssembly;
  });
  await page.goto("/b/gate-check/voice?guest=1");
  await expect(page.getByTestId("tab-speak")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("mic")).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId("mic").click();
  await expect(page.getByTestId("speak-error")).toContainText("browser");
  await page.getByTestId("speak-error").getByRole("button").click();
  await page.getByTestId("words").fill("Typed instead.");
  await expect(page.getByTestId("words")).toHaveValue("Typed instead.");
});

for (const [label, ua, viewport] of [
  ["Windows Chrome", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36", { width: 1366, height: 768 }],
  ["Windows Edge", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0", { width: 1280, height: 720 }],
  ["small phone", "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36", { width: 360, height: 640 }],
] as const) {
  test(`Speak comes first and is visible: ${label}`, async ({ browser }) => {
    const context = await browser.newContext({ userAgent: ua, viewport, deviceScaleFactor: 1 });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "deviceMemory", { value: 1, configurable: true });
    });
    const page = await context.newPage();
    await page.goto("/b/gate-check/voice?guest=1");
    const speak = page.getByTestId("tab-speak");
    await expect(speak).toBeVisible();
    await speak.scrollIntoViewIfNeeded();
    const box = await speak.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= viewport.width).toBeTruthy();
    await expect(speak).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("tab-write")).toBeVisible();
    const order = await page.locator("[role=tab]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")));
    expect(order).toEqual(["tab-speak", "tab-write"]);
    await expect(page.getByTestId("mic")).toBeEnabled({ timeout: 30_000 });
    await context.close();
  });
}

test("the language choice is remembered", async ({ page }) => {
  await page.goto("/b/gate-check/voice?guest=1");
  await page.getByTestId("voice-language").selectOption("ja");
  await page.reload();
  await expect(page.getByTestId("voice-language")).toHaveValue("ja");
  const top = await page.locator("[data-testid=voice-language] option").evaluateAll((nodes) => nodes.slice(0, 8).map((node) => (node as HTMLOptionElement).value));
  expect(top).toEqual(expect.arrayContaining(["en", "hi", "ja"]));
  await page.evaluate(() => localStorage.removeItem("bbtp:voice-language"));
});
