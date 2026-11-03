import { prisma } from "@/lib/db";
import { getAudio, publicAudioUrl } from "@/lib/storage";
import { getCurrentUser } from "@/lib/auth";
import { canGetMedia, isReleasedBook } from "@/lib/privacy";
import { audiobookFor } from "@/lib/media/meta/audiobook";

export async function GET(request: Request, context: { params: Promise<{ slug: string; kind: string }> }) {
  const { slug, kind } = await context.params;
  if (kind !== "audiobook" && kind !== "video") return new Response("Not found", { status: 404 });
  const book = await prisma.book.findUnique({ where: { slug } });
  if (!book) return new Response("Not found", { status: 404 });
  // Before release only the book's owner can play or download the files (never other users or the admin).
  const released = isReleasedBook(book);
  if (!released) {
    const user = await getCurrentUser();
    if (!canGetMedia(book, user ? { id: user.id } : null)) {
      return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
    }
  }
  // ?lang=xx picks the Meta audiobook in one of the book's release languages.
  const lang = (new URL(request.url).searchParams.get("lang") ?? "").toLowerCase();
  let key = kind === "audiobook" ? book.audiobookKey : book.videoKey;
  if (kind === "audiobook" && /^[a-z]{2,3}$/.test(lang) && lang !== (book.language || "en")) {
    key = (await audiobookFor(book.id, lang).catch(() => null))?.key ?? null;
  }
  if (!key) return new Response("Not found", { status: 404 });
  const wantsDownload = new URL(request.url).searchParams.get("download") === "1";
  if (released) {
    // On Vercel a function answer is capped at 4.5 MB, so released media is served straight from Blob storage.
    const direct = await publicAudioUrl(key, wantsDownload).catch(() => null);
    if (direct) return Response.redirect(direct, 302);
  }
  const data = await getAudio(key);
  const video = kind === "video";
  const name =
    (video ? book.videoName : book.audiobookName) ||
    (video ? `${book.slug}.mp4` : key.endsWith(".mp3") ? `${book.slug}${lang && lang !== (book.language || "en") ? `-${lang}` : ""}.mp3` : `${book.slug}.wav`);
  const download = wantsDownload;
  const type = video ? "video/mp4" : key.endsWith(".mp3") ? "audio/mpeg" : "audio/wav";
  const cache = released ? "public, max-age=300" : "private, no-store";
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
