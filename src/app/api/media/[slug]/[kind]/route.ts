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
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": video ? "video/mp4" : key.endsWith(".mp3") ? "audio/mpeg" : "audio/wav",
      "Content-Length": String(data.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name.replace(/"/g, "")}"`,
      "Cache-Control": book.status === "PUBLISHED" ? "public, max-age=300" : "private, no-store",
    },
  });
}
