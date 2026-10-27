import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError } from "@/lib/http";
import { createBook, updateBookSettings } from "@/lib/services/books";

const schema = z.object({
  title: z.string(),
  question: z.string(),
  type: z.string(),
  coverVibe: z.string().optional(),
  closesAt: z.string().nullable().optional(),
  language: z.string().max(16).optional(),
  voiceLimitPerDay: z.number().int().optional(),
  maxVoiceSeconds: z.number().int().optional(),
  aiKey: z.string().max(400).optional(),
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
      language: parsed.language,
      voiceLimitPerDay: parsed.voiceLimitPerDay,
      maxVoiceSeconds: parsed.maxVoiceSeconds,
    });
    if (parsed.aiKey?.trim()) {
      await updateBookSettings({ bookId: book.id, userId: user.id, aiKey: parsed.aiKey });
    }
    return NextResponse.json({ id: book.id, slug: book.slug });
  } catch (error) {
    return fromError(error);
  }
}
