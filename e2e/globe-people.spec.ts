import { expect, test, type Page } from "@playwright/test";
import { BASE, signInRequest } from "./helpers";
import { REST_THETA, START_LNG, phiFacing, project } from "../src/lib/globe-math";

const SECRET = "marigold-whisper";

async function tapIndia(page: Page, touch: boolean) {
  const press = (x: number, y: number) => (touch ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
  const canvas = page.locator(".gwrap canvas");
  const box = (await canvas.boundingBox())!;
  const tip = page.locator(".gtip span");
  // India's centre on the resting globe; the dots sit a few degrees around it.
  for (const [dLat, dLng] of [[0, 0], [1.5, 0], [-1.5, 0], [0, 2], [0, -2], [2.5, 2.5], [-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5]]) {
    const point = project(22.8 + dLat, 79 + dLng, phiFacing(START_LNG), REST_THETA, box.width);
    await press(box.x + point.x, box.y + point.y);
    if ((await tip.textContent())?.trim()) return tip;
    await press(box.x + 4, box.y + 4); // clear before the next try
  }
  return tip;
}

test("open book: names and places under the count and on the globe, words sealed", async ({ browser, request }) => {
  await signInRequest(request, `globe-${Date.now()}@example.com`);
  const created = await request.post("/api/books", {
    headers: { origin: BASE },
    data: { title: `Globe people ${Date.now()}`, question: "What small habit changed your life?", type: "OPEN", coverVibe: "ember", closesAt: null, ai: { source: "demo" } },
  });
  expect(created.ok()).toBeTruthy();
  const book = await created.json();
  const voices = [
    { name: "Asha Rao", region: "Pune", text: `Walking every morning before work cleared my head and gave me time to think. ${SECRET}` },
    { name: "ravi.k@example.com", region: "Mumbai", text: "Writing three lines in a notebook each night helped me notice the small good things in my day." },
    { name: "Meera", region: "", text: "Putting my phone in another room at dinner gave my family back an hour of real talking every evening." },
  ];
  for (const voice of voices) {
    const res = await request.post(`/api/books/${book.id}/voices`, {
      headers: { origin: BASE },
      data: { text: voice.text, mode: "write", name: voice.name, country: "IN", region: voice.region, consent: true, metrics: { activeMs: 40_000, keys: voice.text.length, spoken: 0 } },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }

  for (const phone of [false, true]) {
    const context = await browser.newContext(
      phone ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: "reduce" } : { viewport: { width: 1366, height: 860 }, reducedMotion: "reduce" },
    );
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    const response = await page.goto(`${BASE}/b/${book.slug}`);
    const html = (await response?.text()) ?? "";
    // The page (and its data) carries names and places only: never the words or an email.
    expect(html).not.toContain(SECRET);
    expect(html).not.toContain("example.com");
    expect(html).not.toContain("Writing three lines");

    const panel = page.getByTestId("sealed-panel");
    await expect(panel).toContainText("Their words stay sealed until the book is released.");
    const people = panel.getByTestId("person");
    await expect(people).toHaveCount(3);
    await expect(panel).toContainText("Asha Rao");
    await expect(panel).toContainText("Pune, India");
    await expect(panel).toContainText("ravi k");
    await expect(panel).toContainText("Meera");

    await page.locator(".gwrap canvas").scrollIntoViewIfNeeded();
    const tip = await tapIndia(page, phone);
    await expect(tip).toContainText(/Asha Rao|ravi k|Meera/);
    await expect(tip).toContainText("India");
    await page.screenshot({ path: `test-results/globe-${phone ? "phone" : "desktop"}.png` });
    expect(errors).toEqual([]);
    await context.close();
  }
});
