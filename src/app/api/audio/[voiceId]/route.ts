import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAudio } from "@/lib/storage";

export async function GET(request: Request, context: { params: Promise<{ voiceId: string }> }) {
  const { voiceId } = await context.params;
  const voice = await prisma.voice.findUnique({
    where: { id: voiceId },
    include: { book: { select: { creatorId: true, status: true, publishedDraftId: true } } },
  });
  if (!voice?.storageKey) return new Response("Not found", { status: 404 });
  const user = await getCurrentUser();
  const creator = user?.id === voice.book.creatorId;
  const hiddenFromPublic = voice.hidden || voice.status === "REJECTED" || voice.status === "FAILED" || voice.status === "PROCESSING";
  if (hiddenFromPublic && !creator) return new Response("Not found", { status: 404 });

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
            "Cache-Control": "private, max-age=3600",
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
      "Cache-Control": "private, max-age=3600",
    },
  });
}
