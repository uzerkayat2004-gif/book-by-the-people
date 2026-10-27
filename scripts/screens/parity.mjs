import { chromium } from "/workspace/bbtp-v2/node_modules/playwright/index.mjs";
import fs from "node:fs";
const base = "http://localhost:43123";
const out = process.argv[2];
const only = process.argv[3];
fs.mkdirSync(out, { recursive: true });
const S = "/studio/smarter-or-lazier";
const H = "/?static=1&stage=closed";
const toText = (t, y = 70) => `await page.getByText(${JSON.stringify(t)}, { exact: true }).first().evaluate((e, y) => window.scrollTo(0, e.getBoundingClientRect().top + scrollY - y), ${y})`;
const bottom = `await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))`;
const click = (name, role = "button") => `await page.getByRole(${JSON.stringify(role)}, { name: ${JSON.stringify(name)} }).first().click()`;
const list = [
  ["01-home-1", H, false, []],
  ["01-home-2", H, false, [`await page.locator(".names4").evaluate((e) => window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 250))`]],
  ["01-home-3", H, false, [`await page.locator(".how5").evaluate((e) => window.scrollTo(0, e.getBoundingClientRect().top + scrollY + 30))`]],
  ["01-home-4", H, false, [bottom]],
  ["01-home-5", H, false, [bottom]],
  ["01-home-6", H, false, [bottom]],
  ["02-speak-signin-gate", "/speak", false, []],
  ["03-about-dialog", H, false, [bottom, click("About")]],
  ["04-privacy-dialog", H, false, [bottom, click("Privacy")]],
  ["05-how-ai-checks-dialog", H, false, [bottom, click("How AI checks")]],
  ["06-404", "/nope", false, []],
  ["08-book-countdown", "/book?static=1&stage=closed", false, []],
  ["09-studio-signin-gate", "/studio", false, []],
  ["10-about-page", "/about", false, []],
  ["11-privacy-page", "/privacy", false, []],
  ["20-studio-settings-1", `${S}?tab=settings`, true, []],
  ["20-studio-settings-2", `${S}?tab=settings`, true, [toText("Release time", 76)]],
  ["20-studio-settings-3", `${S}?tab=settings`, true, [bottom]],
  ["20-studio-settings-4-debug-open", `${S}?tab=settings`, true, [bottom, `await page.getByRole("button", { name: /debug/i }).last().click()`, bottom]],
  ["21-studio-ai-at-work-1", `${S}?tab=ai`, true, []],
  ["21-studio-ai-at-work-2", `${S}?tab=ai`, true, [bottom]],
  ["22-studio-make-1", `${S}?tab=make`, true, []],
  ["22-studio-make-2", `${S}?tab=make`, true, [bottom]],
  ["23-studio-release-1", `${S}?tab=release`, true, []],
  ["23-studio-release-2-user-menu", `${S}?tab=release`, true, [`await page.getByRole("button", { name: /my menu/i }).first().click()`]],
  ["30-me-page", "/me", true, []],
  ["31-me-edit-profile-modal", "/me", true, [click("Edit")]],
  ["32-speak-1", "/speak?static=1&step=ready", true, []],
  ["32-speak-language-dropdown", "/speak?static=1&step=ready", true, [`await page.locator("select#language").evaluate(el => { const r = el.getBoundingClientRect(); const c = el.cloneNode(true); c.id = "langlist"; c.size = 24; Object.assign(c.style, { position: "absolute", left: (r.left + scrollX) + "px", top: (r.bottom + scrollY + 2) + "px", width: r.width + "px", height: "auto", zIndex: 50, background: "#1c1c1f", color: "#fff", fontSize: "12px", border: "1px solid #444" }); document.body.appendChild(c); el.style.outline = "2px solid #d23"; window.scrollTo(0, 0); })`]],
  ["33-home-signedin-1", H, true, []],
  ["33-home-signedin-2", H, true, [bottom]],
  ["34-book-signedin", "/book?static=1&stage=closed", true, []],
];
const browser = await chromium.launch();
async function ctxFor(login, big) {
  // Live captures 01-11 were taken in a 1920-wide window; render those at 1920 CSS px, scaled to a 1280x742 image.
  const ctx = await browser.newContext(big ? { viewport: { width: 1920, height: 1113 }, deviceScaleFactor: 2 / 3 } : { viewport: { width: 1280, height: 742 } });
  const page = await ctx.newPage();
  if (login) {
    const r = await page.request.post(base + "/api/auth/magic", { data: { email: "demo@bookbythepeople.dev", next: "/" }, headers: { origin: base } });
    await page.goto((await r.json()).devLink);
  }
  return page;
}
const pages = { false: await ctxFor(false), true: await ctxFor(true), big: await ctxFor(false, true) };
for (const [name, path, login, actions] of list) {
  if (only && !new RegExp(only).test(name)) continue;
  const page = pages[login];
  await page.goto(base + path, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(1300);
  for (const action of actions) {
    try { await eval(`(async () => { ${action} })()`); } catch (e) { console.log("action fail", name, e.message.split("\n")[0]); }
    await page.waitForTimeout(600);
  }
  await page.mouse.move(1270, 730);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log("ok", name);
}
await browser.close();
