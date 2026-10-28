import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError, jsonError } from "@/lib/http";
import { hourly } from "@/lib/rate-limit";
import { localModelsOff } from "@/lib/ai/local-gate";
import { checkProviderInput } from "@/lib/ai/provider-store";
import { testTarget } from "@/lib/ai/provider-client";
import { isLocalType } from "@/lib/ai/provider-types";

export const runtime = "nodejs";

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$|.*\.local$|.*\.internal$)/i;

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
    if (localModelsOff()) {
      const host = new URL(baseUrl).hostname;
      if (isLocalType(type) || PRIVATE_HOST.test(host) || !baseUrl.startsWith("https://")) {
        return jsonError("On this hosted site the model must have a public https:// address.", 400);
      }
    }
    const result = await testTarget({ label: type, type, baseUrl, model, apiKey: key }, "writer");
    return NextResponse.json({ ok: result.ok, message: result.ok ? result.message : result.message.slice(0, 240) });
  } catch (error) {
    return fromError(error);
  }
}
