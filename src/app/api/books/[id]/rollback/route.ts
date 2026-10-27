import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError } from "@/lib/http";
import { rollbackDraft } from "@/lib/services/books";

const schema = z.object({ draftId: z.string() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const parsed = schema.parse(await request.json());
    const result = await rollbackDraft(id, user.id, parsed.draftId);
    return NextResponse.json(result);
  } catch (error) {
    return fromError(error);
  }
}
