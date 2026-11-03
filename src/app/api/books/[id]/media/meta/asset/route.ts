import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fromError, jsonError } from "@/lib/http";
import { getAudio } from "@/lib/storage";

const TYPES: Record<string, string> = { mp3: "audio/mpeg", jpg: "image/jpeg", png: "image/png", webp: "image/webp", json: "application/json", mp4: "video/mp4" };

/** The creator's own Meta media files (narration, pictures), for the browser to put the film together. Owner only. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await requireApiUser();
    const book = await prisma.book.findFirst({ where: { id, creatorId: user.id }, select: { id: true } });
    if (!book) return jsonError("That book is not in your studio.", 404);
    const key = new URL(request.url).searchParams.get("key") ?? "";
    const ext = key.split(".").pop() ?? "";
    if (!key.startsWith(`book-${book.id}-mm-`) || !/^[\w.-]+$/.test(key) || key.includes("..") || !TYPES[ext]) return jsonError("Not found.", 404);
    const bytes = await getAudio(key).catch(() => null);
    if (!bytes) return jsonError("Not found.", 404);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": TYPES[ext], "Cache-Control": "private, max-age=3600", "Content-Length": String(bytes.length) } });
  } catch (error) {
    return fromError(error);
  }
}
