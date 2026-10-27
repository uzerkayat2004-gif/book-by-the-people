import { prisma } from "@/lib/db";
import { getAudio } from "@/lib/storage";
import { getCurrentUser } from "@/lib/auth";

export async function GET(request: Request, context: { params: Promise<{ slug: string; kind: string }> }) {
  const { slug, kind } = await context.params;
  if (kind !== "audiobook" && kind !== "video") return new Response("Not found", { status: 404 });
  const book = await prisma.book.findUnique({ where: { slug } });
  if (!book) return new Response("Not found", { status: 404 });
  if (book.status !== "PUBLISHED") {
    // Before release only the creator can preview the files.
    const user = await getCurrentUser();
    if (!user || user.id !== book.creatorId) return new Response("Not found", { status: 404 });
  }
  const key = kind === "audiobook" ? book.audiobookKey : book.videoKey;
  if (!key) return new Response("Not found", { status: 404 });
  const data = await getAudio(key);
  const video = kind === "video";
  const name =
    (video ? book.videoName : book.audiobookName) ||
    (video ? `${book.slug}.mp4` : key.endsWith(".mp3") ? `${book.slug}.mp3` : `${book.slug}.wav`);
  const download = new URL(request.url).searchParams.get("download") === "1";
  const type = video ? "video/mp4" : key.endsWith(".mp3") ? "audio/mpeg" : "audio/wav";
  const cache = book.status === "PUBLISHED" ? "public, max-age=300" : "private, no-store";
  // Players ask for byte ranges to seek; Safari will not play a video without them.
  const match = /bytes=(\d*)-(\d*)/.exec(request.headers.get("range") ?? "");
  if (match && !download && (match[1] || match[2])) {
    const size = data.length;
    const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const chunk = data.subarray(start, end + 1);
    return new Response(new Uint8Array(chunk), {
      status: 206,
      headers: {
        "Content-Type": type,
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": cache,
      },
    });
  }
  return new Response(new Uint8Array(data), {
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Type": type,
      "Content-Length": String(data.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name.replace(/"/g, "")}"`,
      "Cache-Control": cache,
    },
  });
}
