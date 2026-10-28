import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertSameOrigin, fromError } from "@/lib/http";
import { canLeadHome } from "@/lib/public-books";
import { isNamedAdmin, isSiteAdmin } from "@/lib/site-admin";

const schema = z.object({ featured: z.boolean() });

/** Put a public book on the home page (site admins only). Only one book is featured at a time. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const { featured } = schema.parse(await request.json());
    if (!isSiteAdmin(user.email)) return NextResponse.json({ error: "Only the site owner can choose the home page book." }, { status: 403 });
    // The admin may feature any public, listed book. Only its status and type are read, never its content.
    const book = await prisma.book.findUnique({
      where: { id },
      select: { id: true, creatorId: true, status: true, type: true, publishedDraftId: true, unlisted: true },
    });
    // Without a named admin (a local dev server), a creator may only feature their own book.
    if (!book || (!isNamedAdmin(user.email) && book.creatorId !== user.id)) return NextResponse.json({ error: "Book not found." }, { status: 404 });
    if (featured && book.unlisted) return NextResponse.json({ error: "That book is unlisted (link only)." }, { status: 400 });
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
