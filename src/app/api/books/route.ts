import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError } from "@/lib/http";
import { clientIp, jsonError } from "@/lib/http";
import { hourly } from "@/lib/rate-limit";
import { applyAiChoice, checkAiChoice } from "@/lib/ai/book-ai";
import { createBook } from "@/lib/services/books";

const schema = z.object({
  title: z.string(),
  question: z.string(),
  type: z.string(),
  coverVibe: z.string().optional(),
  closesAt: z.string().nullable().optional(),
  language: z.string().max(16).optional(),
  voiceLimitPerDay: z.number().int().optional(),
  maxVoiceSeconds: z.number().int().optional(),
  /** Where the book's AI comes from. Required: see lib/ai/book-source.ts. */
  ai: z.unknown().optional(),
  /** Older clients: a pasted Meta key. */
  aiKey: z.string().max(400).optional(),
});

export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    if (!hourly(`book:${user.id}`, 20) || !hourly(`book-ip:${clientIp(request)}`, 40)) {
      return jsonError("Too many new books in an hour. Try again later.", 429);
    }
    const parsed = schema.parse(await request.json());
    const ai = await checkAiChoice(user.id, parsed.ai, parsed.aiKey);
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
    await applyAiChoice(user.id, book.id, ai);
    return NextResponse.json({ id: book.id, slug: book.slug });
  } catch (error) {
    return fromError(error);
  }
}
