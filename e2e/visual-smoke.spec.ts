import { expect, test } from "@playwright/test";

test.describe.configure({ retries: 1 });

const pages = [
  { name: "home-closed", path: "/?static=1&stage=closed", heading: /book by/i, text: "Voices are closed" },
  { name: "home-open", path: "/?static=1&stage=before", heading: /book by/i, text: "Add your voice" },
  { name: "home-after", path: "/?static=1&stage=after", heading: /the book is here/i, text: "Chapters" },
  { name: "speak-ready", path: "/b/smarter-or-lazier/voice?static=1&step=ready", heading: null, text: "Say this word first" },
  { name: "speak-gate", path: "/b/smarter-or-lazier/voice?static=1&step=signin", heading: /add your voice/i, text: "Continue with Google" },
  { name: "reader", path: "/b/smarter-or-lazier/read?static=1", heading: null, text: "Chapter 1" },
  { name: "sign-in", path: "/sign-in?static=1", heading: /sign in/i, text: "Email me a link" },
  { name: "missing", path: "/not-a-real-page?static=1", heading: /page not found/i, text: "Go home" },
];

for (const item of pages) {
  test(`visual smoke: ${item.name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(item.path);
    if (item.heading) await expect(page.getByRole("heading", { name: item.heading }).first()).toBeVisible();
    await expect(page.getByText(item.text).first()).toBeVisible();
    await page.screenshot({ path: `docs/parity/smoke/${item.name}-1440.png`, fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `docs/parity/smoke/${item.name}-390.png`, fullPage: false });
  });
}

test("visual smoke: studio", async ({ page, request }) => {
  const magic = await request.post("/api/auth/magic", { data: { email: "demo@bookbythepeople.dev", next: "/studio" } });
  expect(magic.ok()).toBeTruthy();
  const body = await magic.json();
  const link = new URL(body.devLink as string);
  await page.goto(link.toString());
  await expect(page.getByRole("heading", { name: "Studio" })).toBeVisible();
  await page.getByRole("link", { name: "Smarter or lazier" }).click();
  await expect(page.getByRole("heading", { name: "AI at work" })).toBeVisible();
  await expect(page.getByText("You only see the unsure ones.")).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: "docs/parity/smoke/studio-1440.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "docs/parity/smoke/studio-390.png" });
});
