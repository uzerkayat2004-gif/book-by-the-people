import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError } from "@/lib/http";
import { updateBookSettings } from "@/lib/services/books";

const schema = z.object({
  title: z.string().optional(),
  question: z.string().optional(),
  type: z.string().optional(),
  coverVibe: z.string().optional(),
  closesAt: z.string().nullable().optional(),
  pollQuestion: z.string().optional(),
  pollOptions: z.array(z.string()).optional(),
  showPoll: z.boolean().optional(),
  aiPaused: z.boolean().optional(),
  bookNumber: z.number().optional(),
  language: z.string().max(16).optional(),
  voiceLimitPerDay: z.number().int().optional(),
  maxVoiceSeconds: z.number().int().optional(),
  aiKey: z.string().max(400).optional(),
  clearAiKey: z.boolean().optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const parsed = schema.parse(await request.json());
    const book = await updateBookSettings({ bookId: id, userId: user.id, ...parsed });
    return NextResponse.json({ id: book.id, status: book.status });
  } catch (error) {
    return fromError(error);
  }
}
