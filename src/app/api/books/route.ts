import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError } from "@/lib/http";
import { createBook } from "@/lib/services/books";

const schema = z.object({
  title: z.string(),
  question: z.string(),
  type: z.string(),
  coverVibe: z.string().optional(),
  closesAt: z.string().nullable().optional(),
});

export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const parsed = schema.parse(await request.json());
    const book = await createBook({
      userId: user.id,
      title: parsed.title,
      question: parsed.question,
      type: parsed.type,
      coverVibe: parsed.coverVibe ?? "ember",
      closesAt: parsed.closesAt ?? null,
    });
    return NextResponse.json({ id: book.id, slug: book.slug });
  } catch (error) {
    return fromError(error);
  }
}
