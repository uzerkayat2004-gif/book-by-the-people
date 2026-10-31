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

test("no speech support: Speak is hidden and Write just works", async ({ page }) => {
  await page.addInitScript(() => {
    delete (globalThis as unknown as { WebAssembly?: unknown }).WebAssembly;
  });
  await page.goto("/b/gate-check/voice?guest=1");
  await expect(page.getByTestId("words")).toBeVisible();
  await expect(page.getByTestId("tab-speak")).toHaveCount(0);
  await expect(page.getByTestId("mic")).toHaveCount(0);
  await page.getByTestId("words").fill("Typed instead.");
  await expect(page.getByTestId("words")).toHaveValue("Typed instead.");
});

test("the language choice is remembered", async ({ page }) => {
  await page.goto("/b/gate-check/voice?guest=1");
  await page.getByTestId("voice-language").selectOption("ja");
  await page.reload();
  await expect(page.getByTestId("voice-language")).toHaveValue("ja");
  const top = await page.locator("[data-testid=voice-language] option").evaluateAll((nodes) => nodes.slice(0, 8).map((node) => (node as HTMLOptionElement).value));
  expect(top).toEqual(expect.arrayContaining(["en", "hi", "ja"]));
  await page.evaluate(() => localStorage.removeItem("bbtp:voice-language"));
});
