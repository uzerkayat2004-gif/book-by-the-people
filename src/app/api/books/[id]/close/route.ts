import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError } from "@/lib/http";
import { closeBook } from "@/lib/services/books";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const book = await closeBook(id, user.id);
    return NextResponse.json({ status: book.status });
  } catch (error) {
    return fromError(error);
  }
}
