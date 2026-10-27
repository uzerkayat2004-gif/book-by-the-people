import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("Book settings: Data is the last section, below AI model", async ({ page }) => {
  await signIn(page, "demo@bookbythepeople.dev");
  await page.goto("/studio/smarter-or-lazier?tab=settings");
  const ids = await page.locator("[id^='s-']").evaluateAll((nodes) => nodes.map((node) => node.id));
  expect(ids.at(-1)).toBe("s-data");
  expect(ids.indexOf("s-ai")).toBe(ids.length - 2);
  await expect(page.getByText("Audio tools", { exact: true })).toBeVisible();
  await expect(page.getByText("Audiobook voice")).toBeVisible({ timeout: 20_000 });
});

test("Sign-in says plainly when Google is not set up", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByText(/Google sign-in is off here for now|we never post for you/)).toBeVisible();
});
