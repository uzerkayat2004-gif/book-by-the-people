import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError, jsonError } from "@/lib/http";
import { hourly } from "@/lib/rate-limit";
import { localModelsOff } from "@/lib/ai/local-gate";
import { checkProviderInput } from "@/lib/ai/provider-store";
import { testTarget } from "@/lib/ai/provider-client";
import { isLocalType, presetFor } from "@/lib/ai/provider-types";
import { assertPublicModelUrl } from "@/lib/ai/net-guard";

export const runtime = "nodejs";
// The test itself stops after 20 s; this leaves room for a cold start.
export const maxDuration = 30;

/**
 * Tests a key before it is saved: one tiny request to the provider. Nothing is stored and the key is never logged
 * or sent back; error text from the provider has the key masked.
 */
export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    if (!hourly(`ai-check:${user.id}`, 30)) return jsonError("Too many tests in an hour. Try again later.", 429);
    const { type, baseUrl, model, key } = checkProviderInput(await request.json());
    if (localModelsOff() && isLocalType(type)) return jsonError("On this hosted site the model must have a public https:// address.", 400);
    await assertPublicModelUrl(baseUrl);
    const result = await testTarget({ label: presetFor(type).name.replace(/^Google /, "").replace(/\s*·.*$|-compatible$/g, ""), type, baseUrl, model, apiKey: key }, "writer");
    return NextResponse.json({ ok: result.ok, message: result.ok ? result.message : result.message.slice(0, 240) });
  } catch (error) {
    return fromError(error);
  }
}
