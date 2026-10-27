import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError } from "@/lib/http";
import { getFallback, providerStore, setFallback } from "@/lib/ai/providers";

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
    const provider = await providerStore.create(user.id, await request.json());
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
