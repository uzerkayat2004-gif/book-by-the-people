import { visibleQuotes } from "@/lib/book/assemble";
import { currentDocument } from "@/lib/load-book";
import { prisma } from "@/lib/db";
import { canHearVoice, isReleasedBook } from "@/lib/privacy";
import { getAudio } from "@/lib/storage";
import { getViewer } from "@/lib/viewer";

/**
 * One recording. Before release only the book's owner and the person who recorded it can play it.
 * After release anyone can, but only if the published book quotes it. Everything else is a plain 404.
 */
export async function GET(request: Request, context: { params: Promise<{ voiceId: string }> }) {
  const { voiceId } = await context.params;
  const voice = await prisma.voice.findUnique({
    where: { id: voiceId },
    include: { book: { select: { id: true, creatorId: true, status: true, publishedDraftId: true } } },
  });
  if (!voice?.storageKey) return new Response("Not found", { status: 404 });
  const { viewer, guestKey } = await getViewer();
  let usedInRelease = false;
  if (isReleasedBook(voice.book)) {
    const document = await currentDocument(voice.book.id, voice.book.publishedDraftId);
    usedInRelease = Boolean(document && visibleQuotes(document).some((quote) => quote.voiceId === voice.id));
  }
  if (!canHearVoice({ voice, book: voice.book, viewer, guestKey, usedInRelease })) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  }
  const cache = usedInRelease ? "public, max-age=3600" : "private, no-store";

  const data = await getAudio(voice.storageKey);
  const mime = voice.mimeType || "audio/wav";
  const range = request.headers.get("range");
  if (range) {
    const match = /bytes=(\d+)-(\d*)/.exec(range);
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : data.length - 1;
      if (start <= end && start < data.length) {
        const chunk = data.subarray(start, end + 1);
        return new Response(new Uint8Array(chunk), {
          status: 206,
          headers: {
            "Content-Type": mime,
            "Content-Length": String(chunk.length),
            "Content-Range": `bytes ${start}-${end}/${data.length}`,
            "Accept-Ranges": "bytes",
            "Cache-Control": cache,
          },
        });
      }
    }
  }
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(data.length),
      "Accept-Ranges": "bytes",
      "Cache-Control": cache,
    },
  });
}
