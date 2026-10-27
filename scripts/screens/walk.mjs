import { chromium } from "/workspace/bbtp-v2/node_modules/playwright/index.mjs";
import fs from "node:fs";
import { execSync } from "node:child_process";
const BASE = "http://localhost:43123";
const tone = fs.readFileSync("/workspace/bbtp-v2/e2e/tone.wav");
const dir = "/workspace/shots/walk";
fs.rmSync(dir, { recursive: true, force: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir, size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
const wait = (ms) => page.waitForTimeout(ms);
async function cap(text) {
  await page.evaluate((t) => {
    let el = document.getElementById("__cap");
    if (!el) { el = document.createElement("div"); el.id = "__cap"; Object.assign(el.style, { position: "fixed", left: "50%", bottom: "18px", transform: "translateX(-50%)", zIndex: 99999, background: "rgba(0,0,0,.82)", color: "#fff", font: "600 15px system-ui", padding: "8px 14px", borderRadius: "8px", border: "1px solid #c22", pointerEvents: "none" }); document.body.appendChild(el); }
    el.textContent = t;
  }, text).catch(() => {});
}
async function go(path, text, ms = 2200) { await page.goto(BASE + path, { waitUntil: "networkidle" }).catch(() => {}); await cap(text); await wait(ms); }
async function scroll(y, ms = 1400, text) { await page.evaluate((y) => window.scrollTo({ top: y, behavior: "smooth" }), y); if (text) await cap(text); await wait(ms); }
async function signIn(email) {
  const r = await page.request.post(BASE + "/api/auth/magic", { data: { email, next: "/" }, headers: { origin: BASE } });
  const b = await r.json(); await page.goto(b.devLink, { waitUntil: "networkidle" });
}

// Part 1 — owner
await go("/", "Book 1 · public home (voices closed, book being written)", 2600);
await scroll(700, 1600, "Live globe, names marquee, 3 steps"); await scroll(1500, 1600, "Poll for Book 2, footer");
await signIn("demo@bookbythepeople.dev");
await go("/studio", "Owner signs in → Studio: only their own books", 2200);
await go("/studio/smarter-or-lazier?tab=settings", "Studio · Book settings (cover, release time, per-book AI key)", 2400);
await scroll(700, 1500);
await go("/studio/smarter-or-lazier?tab=ai", "Studio · AI at work (one decision per voice)", 2400);
await go("/studio/smarter-or-lazier?tab=make", "Studio · Make the book (+ backup history)", 2400);
await scroll(500, 1400);
await go("/studio/smarter-or-lazier?tab=release", "Studio · Release (audiobook .mp3 + video .mp4)", 2600);
await go("/b/smarter-or-lazier/read", "Reader: plain prose, small count per chapter", 2200);
await scroll(900, 1800);
// Part 2 — new creator
await page.context().clearCookies();
const email = `newcreator-${Date.now()}@example.com`;
await signIn(email);
await go("/books/new", "New creator → Start your own book", 1500);
await page.locator("#question").pressSequentially("What do you hear on your way to work?", { delay: 25 });
await page.locator("#title").pressSequentially("Commute", { delay: 60 });
await cap("Topic, title, cover, mode, language, release date/time, voice limit");
await page.getByRole("radio", { name: "Open" }).check({ force: true }).catch(() => {});
const d = new Date(Date.now() + 10 * 864e5); const pad = (n) => String(n).padStart(2, "0");
await page.locator("#date").fill(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
await page.locator("#time").fill("19:30");
await scroll(400, 1500);
await page.getByRole("button", { name: "Create the book" }).click();
await page.waitForURL(/\/studio\//, { timeout: 30000 });
await cap("Lands in the new book's Studio"); await wait(2400);
const slug = page.url().split("/studio/")[1].split("?")[0];
const books = await (await page.request.get(`${BASE}/api/books`)).json().catch(() => null);
let bookId = null;
try { const list = Array.isArray(books) ? books : books.books; bookId = list.find((b) => b.slug === slug)?.id; } catch {}
await go(`/b/${slug}`, "The book's public page (countdown, globe, steps)", 2400);
await go(`/b/${slug}/speak`, "Speak page: random start word, 30 languages", 2400);
// add two voices through the same API the recorder uses (mock audio)
if (!bookId) { const out = execSync("npx tsx scripts/inspect-db.ts", { cwd: "/workspace/bbtp-v2" }).toString(); bookId = out.split("\n").find((l) => l.split(" ")[1] === slug)?.split(" ")[0]; }
if (!bookId) { const html = await (await page.request.get(`${BASE}/studio/${slug}`)).text(); bookId = (html.match(/"bookId":"([a-z0-9]+)"/) || html.match(/books\/([a-z0-9]{20,})\//) || [])[1]; }
const LINES = ["Every morning I hear the vendors calling out prices before the train doors even open.", "On my way to work I hear my own thoughts more clearly than at any other time of day, the bus is quiet."];
for (const [i, line] of LINES.entries()) {
  const w = await (await page.request.post(`${BASE}/api/books/${bookId}/challenge`, { headers: { origin: BASE }, data: { language: "en" } })).json();
  await page.request.post(`${BASE}/api/books/${bookId}/voices`, { headers: { origin: BASE }, multipart: { audio: { name: "tone.wav", mimeType: "audio/wav", buffer: tone }, challengeId: w.challengeId, name: `Speaker ${i + 1}`, consent: "true", durationMs: "4000", clientTranscript: `${w.startWord}. ${line}` } });
}
await page.request.post(`${BASE}/api/books/${bookId}/close`, { headers: { origin: BASE } });
await go(`/studio/${slug}?tab=ai`, "Two voices in → transcribed, checked, grouped (mock pipeline)", 2800);
await go(`/studio/${slug}?tab=make`, "Voices closed → Make the book", 1500);
await page.getByRole("button", { name: "Make the book", exact: true }).click();
await page.getByRole("link", { name: "Edit the draft" }).waitFor({ timeout: 60000 });
await cap("Draft written: outline, chapters, prose, byline"); await wait(2000);
await page.getByRole("button", { name: 'Publish a version from "Make the book"' }).click();
await page.getByRole("link", { name: "Read", exact: true }).waitFor({ timeout: 90000 });
await cap("Released: reader, audiobook, video, share cards"); await wait(2000);
await go(`/studio/${slug}?tab=release`, "Release tab: download audiobook + video", 2600);
await go(`/b/${slug}/read`, "The new book in the reader", 2400);
await scroll(700, 1800);
await go(`/explore`, "Explore lists it under Released", 2400);
await ctx.close(); await browser.close();
const f = fs.readdirSync(dir).find((x) => x.endsWith(".webm"));
console.log("bookId", bookId);
console.log("video", `${dir}/${f}`, "slug", slug, "bookId", bookId);
