import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError } from "@/lib/http";
import { getViewer } from "@/lib/viewer";
import { approveVoice, deleteVoice, setVoiceHidden, setVoiceNotable } from "@/lib/services/voices";

const schema = z.object({ hidden: z.boolean().optional(), decision: z.enum(["approved", "hidden"]).optional(), notable: z.boolean().optional() });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const parsed = schema.parse(await request.json());
    if (typeof parsed.notable === "boolean" && parsed.hidden === undefined && !parsed.decision) {
      const marked = await setVoiceNotable(id, user.id, parsed.notable);
      return NextResponse.json({ id: marked.id, notable: parsed.notable });
    }
    const voice =
      parsed.decision === "approved"
        ? await approveVoice(id, user.id)
        : await setVoiceHidden(id, user.id, parsed.decision === "hidden" ? true : Boolean(parsed.hidden));
    return NextResponse.json({ id: voice.id, hidden: voice.hidden });
  } catch (error) {
    return fromError(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    // The owner, or whoever recorded it (signed in, or the same browser as a guest).
    const { viewer, guestKey } = await getViewer();
    const { id } = await context.params;
    await deleteVoice(id, viewer?.id ?? null, guestKey);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fromError(error);
  }
}
