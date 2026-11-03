import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const BASE = process.env.E2E_BASE ?? "http://localhost:43123";

/** Signs in through the dev magic link (mock mode returns it instead of emailing). */
export async function signIn(page: Page, email: string, next = "/") {
  const magic = await page.request.post("/api/auth/magic", { data: { email, next }, headers: { origin: BASE } });
  expect(magic.ok()).toBeTruthy();
  const body = await magic.json();
  await page.goto(body.devLink as string);
}

export async function signInRequest(request: APIRequestContext, email: string) {
  const magic = await request.post("/api/auth/magic", { data: { email }, headers: { origin: BASE } });
  const body = await magic.json();
  const verify = await request.get(body.devLink as string);
  expect(verify.ok()).toBeTruthy();
}

export function inDays(days: number) {
  const date = new Date(Date.now() + days * 86_400_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
