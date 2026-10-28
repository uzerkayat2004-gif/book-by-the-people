import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertSameOrigin, fromError } from "@/lib/http";
import { canLeadHome } from "@/lib/public-books";
import { isSiteAdmin } from "@/lib/site-admin";

const schema = z.object({ featured: z.boolean() });

/** Put one of your public books on the home page (site admins only). Only one book is featured at a time. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const { featured } = schema.parse(await request.json());
    if (!isSiteAdmin(user.email)) return NextResponse.json({ error: "Only the site owner can choose the home page book." }, { status: 403 });
    const book = await prisma.book.findFirst({
      where: { id, creatorId: user.id },
      select: { id: true, status: true, type: true, publishedDraftId: true },
    });
    if (!book) return NextResponse.json({ error: "Book not found." }, { status: 404 });
    if (featured && !canLeadHome(book)) {
      return NextResponse.json(
        { error: "Only open or famous books taking voices, or released books, can lead the home page." },
        { status: 400 },
      );
    }
    await prisma.$transaction([
      ...(featured ? [prisma.book.updateMany({ where: { featured: true, id: { not: book.id } }, data: { featured: false } })] : []),
      prisma.book.update({ where: { id: book.id }, data: { featured } }),
    ]);
    return NextResponse.json({ id: book.id, featured });
  } catch (error) {
    return fromError(error);
  }
}
