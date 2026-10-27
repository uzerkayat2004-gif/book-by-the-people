import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError } from "@/lib/http";
import { generateBook } from "@/lib/services/generate";

export const maxDuration = 60;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const url = new URL(request.url);
    const engine = url.searchParams.get("engine") === "local" ? "local" : "auto";
    const result = await generateBook(id, user.id, engine);
    return NextResponse.json(result);
  } catch (error) {
    return fromError(error);
  }
}
