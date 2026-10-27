import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError } from "@/lib/http";
import { removeSampleData, resetTestData, resetVotes } from "@/lib/services/backups";

const schema = z.object({ action: z.enum(["reset-test-data", "remove-samples", "reset-votes"]) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const { action } = schema.parse(await request.json());
    if (action === "reset-test-data") {
      await resetTestData(id, user.id);
      return NextResponse.json({ ok: true });
    }
    if (action === "remove-samples") return NextResponse.json({ removed: await removeSampleData(id, user.id) });
    return NextResponse.json({ removed: await resetVotes(id, user.id) });
  } catch (error) {
    return fromError(error);
  }
}
