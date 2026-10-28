import { expect, test } from "@playwright/test";
import { BASE, inDays, signIn } from "./helpers";

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
  await page.locator("#aiKey").fill("sk-test-commute-12345");
  await page.getByRole("button", { name: "Create the book" }).click();
  await expect(page).toHaveURL(/\/studio\/commute/);
  await expect(page.getByRole("heading", { name: "Book settings" })).toBeVisible();

  // Only their own book is in their Studio list.
  await page.goto("/studio");
  await expect(page.getByRole("link", { name: /Commute/ })).toBeVisible();
  await expect(page.locator(".bcard", { hasText: "Is AI making you" })).toHaveCount(0);

  // Invited books are never listed in Books.
  await page.goto("/books");
  await expect(page.getByText("Commute")).toHaveCount(0);
});

test("create-book is reachable from home, My page and the Studio", async ({ page }) => {
  await signIn(page, `reach-${Date.now()}@example.com`);
  for (const path of ["/me", "/studio", "/books"]) {
    await page.goto(path);
    await expect(page.locator('a[href="/books/new"]').first()).toBeVisible();
  }
  await page.goto("/");
  await expect(page.locator('a[href="/books/new"]').first()).toBeAttached();
});

test("the AI step is required, and a saved key turns into a model picker", async ({ page }) => {
  const email = `aikey-${Date.now()}@example.com`;
  await signIn(page, email, "/books/new");
  await page.goto("/books/new");
  const step = page.locator(".aisrc");
  await expect(step).toContainText("Your AI");
  await expect(step.locator(".setcard__head")).not.toContainText(/optional/i);
  await expect(step.getByRole("radio", { name: "Meta" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#aiModel")).toHaveValue("muse-spark-1.3");

  // No key: the form stops with a short error and nothing is created.
  await page.locator("#question").fill("What did your grandmother cook on Sundays?");
  await page.getByRole("button", { name: "Create the book" }).click();
  await expect(page.locator(".aisrc p.err[role=alert]")).toHaveText("Paste your AI key, or pick a saved one.");
  await expect(page).toHaveURL(/\/books\/new/);

  // The server says no too.
  const bare = await page.request.post("/api/books", {
    headers: { origin: BASE },
    data: { title: "No AI", question: "Can a book start with no AI?", type: "OPEN", closesAt: null },
  });
  expect(bare.status()).toBe(400);
  expect((await bare.json()).error).toBe("Add your AI key, or pick a saved model.");

  await page.locator("#aiKey").fill("sk-test-sunday-12345");
  await page.getByRole("button", { name: "Create the book" }).click();
  await expect(page).toHaveURL(/\/studio\//);
  await expect(page.getByText("This book has no AI key yet")).toHaveCount(0);

  // Next book: the saved key shows as a model picker, Meta's newest first.
  await page.goto("/books/new");
  const saved = page.getByRole("radiogroup", { name: "Saved AI" });
  await expect(saved.getByRole("radio", { name: /Meta · Muse Spark/ })).toHaveAttribute("aria-checked", "true");
  await expect(saved).toContainText("••••2345");
  await expect(step.getByLabel("Model").locator("option").first()).toHaveText(/^muse-wonder-1\.0/);
  await expect(step.getByLabel("Model")).toHaveValue("muse-spark-1.3");
  await expect(page.locator("#aiKey")).toHaveCount(0);
  await step.getByRole("button", { name: "+ Use a new key" }).click();
  await expect(page.locator("#aiKey")).toBeVisible();
  await step.getByRole("button", { name: "Use a saved model" }).click();
  await page.locator("#question").fill("Which song takes you home?");
  await page.getByRole("button", { name: "Create the book" }).click();
  await expect(page).toHaveURL(/\/studio\//);
});

test("a book with no key says so in Book settings", async ({ page }) => {
  await signIn(page, `nokey-${Date.now()}@example.com`);
  const res = await page.request.post("/api/books", {
    headers: { origin: BASE },
    data: { title: "Demo only", question: "What would you build with no AI?", type: "OPEN", closesAt: null, ai: { source: "demo" } },
  });
  const { slug } = await res.json();
  await page.goto(`/studio/${slug}?tab=settings`);
  await expect(page.getByText("This book has no AI key yet")).toBeVisible();
  await page.getByRole("link", { name: "Add a key" }).click();
  await expect(page.getByRole("dialog", { name: "Add model" })).toBeVisible();
});

test("a new creator with no books gets the first-run guide", async ({ page }) => {
  await signIn(page, `first-${Date.now()}@example.com`);
  await page.goto("/studio");
  await expect(page.getByRole("heading", { name: "Make your first book" })).toBeVisible();
  await page.getByRole("link", { name: "Start your first book" }).click();
  await expect(page.getByRole("heading", { name: "Your first book" })).toBeVisible();
});
