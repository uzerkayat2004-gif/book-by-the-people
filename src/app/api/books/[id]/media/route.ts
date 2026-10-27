import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError } from "@/lib/http";
import { prisma } from "@/lib/db";
import { putAudio } from "@/lib/storage";

const LIMITS = { audiobook: 60 * 1024 * 1024, video: 200 * 1024 * 1024 };
const TYPES: Record<string, { kind: "audiobook" | "video"; ext: string }> = {
  "audio/mpeg": { kind: "audiobook", ext: "mp3" },
  "audio/mp3": { kind: "audiobook", ext: "mp3" },
  "audio/wav": { kind: "audiobook", ext: "wav" },
  "audio/x-wav": { kind: "audiobook", ext: "wav" },
  "video/mp4": { kind: "video", ext: "mp4" },
};

function cleanName(name: string, ext: string) {
  const base = name.replace(/[^\w.\- ]+/g, "").trim().slice(0, 80);
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base || "file"}.${ext}`;
}

/** Replace the audiobook (mp3/wav) or video (mp4) shown on the Release tab. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const book = await prisma.book.findFirst({ where: { id, creatorId: user.id } });
    if (!book) return NextResponse.json({ error: "That book is not in your studio." }, { status: 404 });
    const form = await request.formData();
    const kind = String(form.get("kind") ?? "");
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Pick a file." }, { status: 400 });
    const type = TYPES[file.type];
    if (!type || type.kind !== kind) {
      return NextResponse.json(
        { error: kind === "video" ? "The video must be an MP4." : "The audiobook must be an MP3 or WAV." },
        { status: 400 },
      );
    }
    if (file.size > LIMITS[type.kind]) return NextResponse.json({ error: "That file is too large." }, { status: 413 });
    const body = Buffer.from(await file.arrayBuffer());
    const key = `book-${book.id}-${type.kind}-upload.${type.ext}`;
    await putAudio(key, body, file.type);
    const name = cleanName(file.name, type.ext);
    await prisma.book.update({
      where: { id: book.id },
      data:
        type.kind === "audiobook"
          ? { audiobookKey: key, audiobookBytes: body.length, audiobookName: name }
          : { videoKey: key, videoBytes: body.length, videoName: name },
    });
    return NextResponse.json({ name, bytes: body.length });
  } catch (error) {
    return fromError(error);
  }
}
