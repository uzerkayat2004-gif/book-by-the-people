import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertSameOrigin, fromError, jsonError } from "@/lib/http";
import { advanceAudiobook, audiobookPanel, savePicks, startAudiobook, progressOf } from "@/lib/media/meta/audiobook";

export const maxDuration = 300;

async function ownBook(id: string) {
  const user = await requireApiUser();
  const book = await prisma.book.findFirst({ where: { id, creatorId: user.id }, select: { id: true } });
  return book;
}

/** Studio: pickers, saved choices and progress for the Meta audiobook. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const book = await ownBook(id);
    if (!book) return jsonError("That book is not in your studio.", 404);
    return NextResponse.json(await audiobookPanel(book.id));
  } catch (error) {
    return fromError(error);
  }
}

const picksSchema = z.object({
  writer: z.string().max(200).optional(),
  voices: z.record(z.string().max(8), z.string().max(40)).optional(),
  music: z.boolean().optional(),
});

/** Save the model picks for this book. */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const { id } = await context.params;
    const book = await ownBook(id);
    if (!book) return jsonError("That book is not in your studio.", 404);
    await savePicks(book.id, picksSchema.parse(await request.json()));
    return NextResponse.json(await audiobookPanel(book.id));
  } catch (error) {
    return fromError(error);
  }
}

const actionSchema = z.object({ action: z.enum(["start", "step"]) });

/** start: begin a run with the saved picks. step: do the next bit of work (Studio calls this until it is ready). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const { id } = await context.params;
    const book = await ownBook(id);
    if (!book) return jsonError("That book is not in your studio.", 404);
    const { action } = actionSchema.parse(await request.json());
    if (action === "start") return NextResponse.json(progressOf(await startAudiobook(book.id)));
    return NextResponse.json(await advanceAudiobook(book.id, 200_000));
  } catch (error) {
    return fromError(error);
  }
}
