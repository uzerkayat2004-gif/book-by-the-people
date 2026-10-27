import { chromium } from "/workspace/bbtp-v2/node_modules/playwright/index.mjs";
const base = process.env.BASE || "http://127.0.0.1:43123";
const out = process.argv[2] || "/workspace/shots/cur";
const list = JSON.parse(process.argv[3]);
import fs from "node:fs"; fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: Number(process.env.W||1280), height: Number(process.env.H||742) }, deviceScaleFactor: Number(process.env.DPR||1) });
const page = await ctx.newPage();
if (process.env.LOGIN) {
  const r = await page.request.post(base + "/api/auth/magic", { data: { email: process.env.LOGIN, next: "/" }, headers: { origin: base } });
  const b = await r.json(); await page.goto(b.devLink);
}
for (const [name, path, scroll, action] of list) {
  await page.goto(base + path, { waitUntil: "networkidle" }).catch(()=>{});
  await page.waitForTimeout(1200);
  if (action) { try { await eval(action); } catch (e) { console.log("action fail", name, e.message); } await page.waitForTimeout(700); }
  if (scroll) { await page.evaluate((y) => window.scrollTo(0, y), scroll); await page.waitForTimeout(700); }
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log("ok", name);
}
await browser.close();
