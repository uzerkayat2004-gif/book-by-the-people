import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError } from "@/lib/http";
import { addSampleQuotes } from "@/lib/services/voices";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const added = await addSampleQuotes(id, user.id);
    return NextResponse.json({ added });
  } catch (error) {
    return fromError(error);
  }
}
