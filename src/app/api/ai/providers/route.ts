import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError } from "@/lib/http";
import { providerStore } from "@/lib/ai/providers";

export const runtime = "nodejs";

/** The signed-in creator's AI models. Keys never leave the server; only the last 4 characters do. */
export async function GET() {
  try {
    const user = await requireApiUser();
    return NextResponse.json({ providers: await providerStore.list(user.id) });
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

const orderSchema = z.object({ ids: z.array(z.string().max(40)).max(50) });

/** Reorders by priority: the first id is tried first. */
export async function PUT(request: Request) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const { ids } = orderSchema.parse(await request.json());
    return NextResponse.json({ providers: await providerStore.reorder(user.id, ids) });
  } catch (error) {
    return fromError(error);
  }
}
