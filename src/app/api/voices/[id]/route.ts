import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError } from "@/lib/http";
import { deleteVoice, setVoiceHidden } from "@/lib/services/voices";

const schema = z.object({ hidden: z.boolean() });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const parsed = schema.parse(await request.json());
    const voice = await setVoiceHidden(id, user.id, parsed.hidden);
    return NextResponse.json({ id: voice.id, hidden: voice.hidden });
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
    await deleteVoice(id, user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fromError(error);
  }
}
