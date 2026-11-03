import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertSameOrigin, fromError, jsonError } from "@/lib/http";
import { CHUNK_BYTES, saveChunk } from "@/lib/media/meta/videobook";

export const maxDuration = 60;

/** One part (at most 3 MB) of the film the browser made. ?upload=<run id>&part=<n> */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const { id } = await context.params;
    const user = await requireApiUser();
    const book = await prisma.book.findFirst({ where: { id, creatorId: user.id }, select: { id: true } });
    if (!book) return jsonError("That book is not in your studio.", 404);
    const url = new URL(request.url);
    const uploadId = url.searchParams.get("upload") ?? "";
    const part = Number(url.searchParams.get("part"));
    if (!/^[0-9a-f-]{36}$/.test(uploadId)) return jsonError("Bad upload.", 400);
    if (Number(request.headers.get("content-length") ?? 0) > CHUNK_BYTES) return jsonError("Part too large.", 413);
    const bytes = Buffer.from(await request.arrayBuffer());
    await saveChunk(book.id, uploadId, part, bytes);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fromError(error);
  }
}
