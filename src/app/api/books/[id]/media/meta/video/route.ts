import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertSameOrigin, fromError, jsonError } from "@/lib/http";
import { advanceVideo, filmFailed, filmPlan, finishFilm, readVideo, saveVideoPicks, startVideo, videoPanel, videoProgressOf } from "@/lib/media/meta/videobook";

export const maxDuration = 300;

async function ownBook(id: string) {
  const user = await requireApiUser();
  return prisma.book.findFirst({ where: { id, creatorId: user.id }, select: { id: true } });
}

/** Studio: pickers and progress for the Meta video book. ?plan=1 returns the film plan the browser renders. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const book = await ownBook(id);
    if (!book) return jsonError("That book is not in your studio.", 404);
    if (new URL(request.url).searchParams.get("plan")) return NextResponse.json(await filmPlan(book.id));
    return NextResponse.json(await videoPanel(book.id));
  } catch (error) {
    return fromError(error);
  }
}

const picksSchema = z.object({ writer: z.string().max(200).optional(), images: z.string().max(200).optional(), voice: z.string().max(40).optional() });

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const { id } = await context.params;
    const book = await ownBook(id);
    if (!book) return jsonError("That book is not in your studio.", 404);
    await saveVideoPicks(book.id, picksSchema.parse(await request.json()));
    return NextResponse.json(await videoPanel(book.id));
  } catch (error) {
    return fromError(error);
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("step") }),
  z.object({ action: z.literal("finish"), uploadId: z.string().uuid(), parts: z.number().int().min(1).max(200), ms: z.number().min(0).max(36_000_000), codec: z.string().max(40) }),
  z.object({ action: z.literal("failed"), message: z.string().max(400) }),
]);

/** start / step (Studio repeats until the film can be put together) / finish (after the upload) / failed (the browser could not encode). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const { id } = await context.params;
    const book = await ownBook(id);
    if (!book) return jsonError("That book is not in your studio.", 404);
    const body = actionSchema.parse(await request.json());
    if (body.action === "start") {
      await startVideo(book.id);
      return NextResponse.json(videoProgressOf(await readVideo(book.id), null));
    }
    if (body.action === "finish") return NextResponse.json(await finishFilm(book.id, body));
    if (body.action === "failed") return NextResponse.json(await filmFailed(book.id, body.message));
    return NextResponse.json(await advanceVideo(book.id, 200_000));
  } catch (error) {
    return fromError(error);
  }
}
