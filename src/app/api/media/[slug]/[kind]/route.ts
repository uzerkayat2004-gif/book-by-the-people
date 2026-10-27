import { prisma } from "@/lib/db";
import { getAudio } from "@/lib/storage";

export async function GET(request: Request, context: { params: Promise<{ slug: string; kind: string }> }) {
  const { slug, kind } = await context.params;
  if (kind !== "audiobook" && kind !== "video") return new Response("Not found", { status: 404 });
  const book = await prisma.book.findUnique({ where: { slug } });
  if (!book || book.status !== "PUBLISHED") return new Response("Not found", { status: 404 });
  const key = kind === "audiobook" ? book.audiobookKey : book.videoKey;
  if (!key) return new Response("Not found", { status: 404 });
  const data = await getAudio(key);
  const video = kind === "video";
  const name = video ? `${book.slug}.mp4` : key.endsWith(".mp3") ? `${book.slug}.mp3` : `${book.slug}.wav`;
  const download = new URL(request.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": video ? "video/mp4" : key.endsWith(".mp3") ? "audio/mpeg" : "audio/wav",
      "Content-Length": String(data.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
