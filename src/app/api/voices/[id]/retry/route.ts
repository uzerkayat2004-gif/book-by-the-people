import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError } from "@/lib/http";
import { retryTranscription } from "@/lib/services/voices";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { transcript?: unknown };
    const typed = typeof body.transcript === "string" ? body.transcript : null;
    const voice = await retryTranscription(id, user.id, typed);
    return NextResponse.json({
      id: voice.id,
      status: voice.status,
      originalText: voice.originalText,
      englishText: voice.englishText,
      rejectReason: voice.rejectReason,
    });
  } catch (error) {
    return fromError(error);
  }
}
