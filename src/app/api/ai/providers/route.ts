import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError, jsonError } from "@/lib/http";
import { getFallback, providerStore, setFallback } from "@/lib/ai/providers";
import { assertPublicModelUrl } from "@/lib/ai/net-guard";
import { checkProviderInput } from "@/lib/ai/provider-store";
import { isLocalType } from "@/lib/ai/provider-types";
import { LOCAL_OFF_MESSAGE, localModelsOff } from "@/lib/ai/local-gate";
import { hourly } from "@/lib/rate-limit";

export const runtime = "nodejs";

/** The signed-in creator's AI models. Keys never leave the server; only the last 4 characters do. */
export async function GET() {
  try {
    const user = await requireApiUser();
    const [providers, fallback] = await Promise.all([providerStore.list(user.id), getFallback(user.id)]);
    return NextResponse.json({ providers, fallback });
  } catch (error) {
    return fromError(error);
  }
}

export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    if (!hourly(`ai-provider:${user.id}`, 60)) return jsonError("Too many changes in an hour. Try again later.", 429);
    const body = await request.json();
    const { type, baseUrl } = checkProviderInput(body);
    if (localModelsOff() && isLocalType(type)) return jsonError(LOCAL_OFF_MESSAGE, 400);
    await assertPublicModelUrl(baseUrl);
    const provider = await providerStore.create(user.id, body);
    return NextResponse.json({ provider });
  } catch (error) {
    return fromError(error);
  }
}

const orderSchema = z
  .object({ ids: z.array(z.string().max(40)).max(50).optional(), fallback: z.boolean().optional() })
  .refine((body) => body.ids !== undefined || body.fallback !== undefined, "Send ids or fallback.");

/** Reorders by priority (the first id runs everything) and/or turns fallback on or off. */
export async function PUT(request: Request) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const { ids, fallback } = orderSchema.parse(await request.json());
    const next = fallback === undefined ? await getFallback(user.id) : await setFallback(user.id, fallback);
    const providers = ids ? await providerStore.reorder(user.id, ids) : await providerStore.list(user.id);
    return NextResponse.json({ providers, fallback: next });
  } catch (error) {
    return fromError(error);
  }
}
