import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("Book settings: Data is the last section, below AI model", async ({ page }) => {
  await signIn(page, "demo@bookbythepeople.dev");
  await page.goto("/studio/smarter-or-lazier?tab=settings");
  const ids = await page.locator("[id^='s-']").evaluateAll((nodes) => nodes.map((node) => node.id));
  expect(ids.at(-1)).toBe("s-data");
  expect(ids.indexOf("s-ai")).toBe(ids.length - 2);
  // Meta-only (the hackathon default) hides the built-in eSpeak voice and ffmpeg tools.
  const metaOnly = !["0", "false", "off", "no"].includes((process.env.HACKATHON_META_ONLY ?? "1").trim().toLowerCase());
  if (metaOnly) {
    await expect(page.locator("#s-ai")).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.getByText("Audio tools", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/eSpeak/)).toHaveCount(0);
  } else await expect(page.getByText("Audio tools", { exact: true })).toBeVisible();
  if (!metaOnly) await expect(page.getByText("Audiobook voice")).toBeVisible({ timeout: 20_000 });
});

test("New book form: optional release languages", async ({ page }) => {
  await signIn(page, `newbook-${Date.now()}@example.com`);
  await page.goto("/books/new");
  const pick = page.getByTestId("new-release-language");
  await expect(pick).toBeVisible();
  await expect(pick.locator("option").first()).toHaveText("Only the main language");
  await pick.selectOption("hi");
  await expect(page.getByTestId("new-release-languages")).toContainText("Hindi");
  await page.getByRole("button", { name: /Remove Hindi/ }).click();
  await expect(page.getByTestId("new-release-languages")).toHaveCount(0);
});

test("Sign-in says plainly when Google is not set up", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByText(/Google sign-in is off here for now|we never post for you/)).toBeVisible();
});
