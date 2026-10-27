import { expect, test } from "@playwright/test";
import { inDays, signIn } from "./helpers";

test("a new creator makes a book and lands in its Studio", async ({ page }) => {
  await signIn(page, `creator-${Date.now()}@example.com`, "/books/new");
  await page.goto("/books/new");
  await page.locator("#question").fill("What do you hear on your way to work?");
  await page.locator("#title").fill("Commute");
  await page.getByRole("radio", { name: "Invited" }).check({ force: true });
  await page.locator("#language").selectOption("hi");
  await page.locator("#limit").fill("2");
  await page.locator("#date").fill(inDays(10));
  await page.locator("#time").fill("19:30");
  await expect(page.getByLabel("Cover preview")).toContainText(/commute/i);
  await page.getByRole("button", { name: "Create the book" }).click();
  await expect(page).toHaveURL(/\/studio\/commute/);
  await expect(page.getByRole("heading", { name: "Book settings" })).toBeVisible();

  // Only their own book is in their Studio list.
  await page.goto("/studio");
  await expect(page.getByRole("link", { name: /Commute/ })).toBeVisible();
  await expect(page.locator(".bcard", { hasText: "Is AI making you" })).toHaveCount(0);

  // Invited books are not listed on Explore until released.
  await page.goto("/explore");
  await expect(page.getByText("Commute")).toHaveCount(0);
});

test("create-book is reachable from home, My page and the Studio", async ({ page }) => {
  await signIn(page, `reach-${Date.now()}@example.com`);
  for (const path of ["/me", "/studio", "/explore"]) {
    await page.goto(path);
    await expect(page.locator('a[href="/books/new"]').first()).toBeVisible();
  }
  await page.goto("/");
  await expect(page.locator('a[href="/books/new"]').first()).toBeAttached();
});
