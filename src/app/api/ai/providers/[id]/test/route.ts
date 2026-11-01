import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError, jsonError } from "@/lib/http";
import { hourly } from "@/lib/rate-limit";
import { providerStore, testProvider } from "@/lib/ai/providers";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Sends one minimal real request to the model and stores the result. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    if (!hourly(`ai-check:${user.id}`, 30)) return jsonError("Too many tests in an hour. Try again later.", 429);
    const result = await testProvider(user.id, id);
    const provider = (await providerStore.list(user.id)).find((item) => item.id === id) ?? null;
    return NextResponse.json({ ...result, provider });
  } catch (error) {
    return fromError(error);
  }
}
