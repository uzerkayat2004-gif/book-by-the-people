import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { parseDocument } from "@/lib/book/assemble";
import { prisma } from "@/lib/db";
import { assertSameOrigin, fromError, jsonError } from "@/lib/http";
import { mediaMetaOnly } from "@/lib/media/meta/flag";
import { makeMediaInBackground, runAfterResponse } from "@/lib/services/books";

export const maxDuration = 300;

/** Speak the book into the audiobook (and video when ffmpeg is there). Runs in the background and replaces uploads. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const book = await prisma.book.findFirst({ where: { id, creatorId: user.id } });
    if (!book) return jsonError("That book is not in your studio.", 404);
    if (mediaMetaOnly()) return jsonError("The built-in voice is off for now. Make the Meta audiobook or video book in Release.", 409);
    const draftId = book.currentDraftId ?? book.publishedDraftId;
    const draft = draftId ? await prisma.bookDraft.findUnique({ where: { id: draftId } }) : null;
    const document = draft ? parseDocument(draft.contentJson) : null;
    if (!document) return jsonError("Make the book first.");
    runAfterResponse(() => makeMediaInBackground(book.id, document, true));
    return NextResponse.json({ status: "running" });
  } catch (error) {
    return fromError(error);
  }
}

/** Status of the audiobook job. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const book = await prisma.book.findFirst({ where: { id, creatorId: user.id }, select: { id: true } });
    if (!book) return jsonError("That book is not in your studio.", 404);
    const job = await prisma.pipelineJob.findUnique({ where: { key: `${book.id}:make:media` } });
    return NextResponse.json({ status: job?.status ?? "none", note: job?.lastError ?? null });
  } catch (error) {
    return fromError(error);
  }
}
