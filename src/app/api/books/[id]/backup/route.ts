import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError } from "@/lib/http";
import { prisma } from "@/lib/db";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const book = await prisma.book.findFirst({
      where: { id, creatorId: user.id },
      include: { _count: { select: { voices: true } } },
    });
    if (!book) return NextResponse.json({ error: "That book is not in your studio." }, { status: 404 });
    const backup = await prisma.backup.create({
      data: {
        bookId: book.id,
        voiceCount: book._count.voices,
        label: "Just now",
        note: "Saved from the studio.",
      },
    });
    return NextResponse.json({ id: backup.id, voices: backup.voiceCount });
  } catch (error) {
    return fromError(error);
  }
}
