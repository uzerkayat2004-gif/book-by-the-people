import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError, jsonError } from "@/lib/http";
import { providerStore } from "@/lib/ai/providers";
import { assertPublicModelUrl } from "@/lib/ai/net-guard";
import { cleanBaseUrl } from "@/lib/ai/provider-store";
import { isLocalType, presetFor } from "@/lib/ai/provider-types";
import { LOCAL_OFF_MESSAGE, localModelsOff } from "@/lib/ai/local-gate";
import { hourly } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    if (!hourly(`ai-provider:${user.id}`, 60)) return jsonError("Too many changes in an hour. Try again later.", 429);
    const body = (await request.json()) as { type?: unknown; baseUrl?: unknown };
    const type = typeof body.type === "string" ? body.type : "";
    if (type && localModelsOff() && isLocalType(type)) return jsonError(LOCAL_OFF_MESSAGE, 400);
    if (typeof body.baseUrl === "string" || type) {
      const raw = typeof body.baseUrl === "string" && body.baseUrl.trim() ? body.baseUrl : presetFor(type || "custom").baseUrl;
      if (raw) await assertPublicModelUrl(cleanBaseUrl(raw));
    }
    return NextResponse.json({ provider: await providerStore.update(user.id, id, body) });
  } catch (error) {
    return fromError(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    await providerStore.remove(user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fromError(error);
  }
}
