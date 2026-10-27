import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError } from "@/lib/http";
import { prisma } from "@/lib/db";
import { tickBook } from "@/lib/services/pipeline";
import { bookLimit, bookSpendPaused, bookUsage } from "@/lib/services/spend";
import { limitShare, usageLine } from "@/lib/ai/spend";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const book = await prisma.book.findFirst({ where: { OR: [{ id }, { slug: id }], creatorId: user.id } });
    if (!book) return NextResponse.json({ error: "That book is not in your studio." }, { status: 404 });
    const result = await tickBook(book.id);
    const [usage, limit, reached] = await Promise.all([bookUsage(book.id), bookLimit(book.id), bookSpendPaused(book.id)]);
    return NextResponse.json({ ...result, usage: { line: usageLine(usage, limit), share: limitShare(usage, limit), reached } });
  } catch (error) {
    return fromError(error);
  }
}
