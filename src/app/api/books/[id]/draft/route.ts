import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError } from "@/lib/http";
import { saveDraftEdits } from "@/lib/services/books";

const schema = z.object({
  preface: z.string(),
  chapters: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      narrative: z.string(),
      hiddenQuoteIds: z.array(z.string()),
    }),
  ),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const edits = schema.parse(await request.json());
    const draft = await saveDraftEdits(id, user.id, edits);
    return NextResponse.json({ draftId: draft.id, version: draft.version });
  } catch (error) {
    return fromError(error);
  }
}
