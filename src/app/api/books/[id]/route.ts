import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError } from "@/lib/http";
import { setBookModel } from "@/lib/ai/book-ai";
import { deleteBookForever, updateBookSettings } from "@/lib/services/books";
import { isNamedAdmin } from "@/lib/site-admin";

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
  /** Which saved model this book runs on ("" = the first in the creator's list). */
  aiProviderId: z.string().max(40).optional(),
  aiModel: z.string().max(200).optional(),
  unlisted: z.boolean().optional(),
  usageLimit: z.object({ kind: z.enum(["none", "usd", "tokens"]), value: z.union([z.number(), z.string().max(40)]).nullable().optional() }).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const { aiProviderId, aiModel, ...parsed } = schema.parse(await request.json());
    const book = await updateBookSettings({ bookId: id, userId: user.id, ...parsed });
    if (aiProviderId !== undefined) await setBookModel(user.id, book.id, aiProviderId, aiModel ?? "");
    return NextResponse.json({ id: book.id, status: book.status });
  } catch (error) {
    return fromError(error);
  }
}

/** Delete a book: its owner, or the site admin for an abusive book. Nothing of the book is read or returned. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const done = await deleteBookForever(id, { id: user.id, isAdmin: isNamedAdmin(user.email) });
    return NextResponse.json({ id: done.id, deleted: true });
  } catch (error) {
    return fromError(error);
  }
}
