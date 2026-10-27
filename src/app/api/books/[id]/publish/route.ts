import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError } from "@/lib/http";
import { publishBook } from "@/lib/services/books";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const book = await publishBook(id, user.id);
    return NextResponse.json({ status: book.status, slug: book.slug });
  } catch (error) {
    return fromError(error);
  }
}
