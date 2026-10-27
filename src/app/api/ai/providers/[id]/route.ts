import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError } from "@/lib/http";
import { providerStore } from "@/lib/ai/providers";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    return NextResponse.json({ provider: await providerStore.update(user.id, id, await request.json()) });
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
