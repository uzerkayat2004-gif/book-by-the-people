import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError } from "@/lib/http";
import { prisma } from "@/lib/db";
import { tickBook } from "@/lib/services/pipeline";
import { bookSpendUsd } from "@/lib/services/spend";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const book = await prisma.book.findFirst({ where: { OR: [{ id }, { slug: id }], creatorId: user.id } });
    if (!book) return NextResponse.json({ error: "That book is not in your studio." }, { status: 404 });
    const result = await tickBook(book.id);
    const spent = await bookSpendUsd(book.id);
    return NextResponse.json({ ...result, spent });
  } catch (error) {
    return fromError(error);
  }
}
