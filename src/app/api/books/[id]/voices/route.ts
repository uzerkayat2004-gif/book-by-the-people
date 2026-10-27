import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { assertSameOrigin, clientIp, fromError, jsonError } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { ingestRecording } from "@/lib/services/voices";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const ip = clientIp(request);
    if (!rateLimit(`voice:${ip}`, 20, 60 * 60 * 1000)) {
      return jsonError("Too many recordings from here. Try again later.", 429);
    }
    const { id } = await context.params;
    const form = await request.formData();
    const audio = form.get("audio");
    if (!(audio instanceof File)) return jsonError("Record or upload a voice first.");
    const user = await getCurrentUser();
    const voice = await ingestRecording({
      bookId: id,
      viewerId: user?.id ?? null,
      invite: String(form.get("invite") ?? "") || null,
      challengeId: String(form.get("challengeId") ?? ""),
      name: String(form.get("name") ?? ""),
      countryCode: String(form.get("country") ?? "") || null,
      handle: String(form.get("handle") ?? ""),
      ageBand: String(form.get("ageBand") ?? ""),
      region: String(form.get("region") ?? ""),
      consent: form.get("consent") === "true" || form.get("consent") === "on",
      durationMs: Number(form.get("durationMs") ?? 0) || 0,
      clientTranscript: String(form.get("clientTranscript") ?? "") || null,
      audio: Buffer.from(await audio.arrayBuffer()),
      mimeType: audio.type || "application/octet-stream",
      ip,
    });
    return NextResponse.json({
      id: voice.id,
      status: voice.status,
      originalText: voice.originalText,
      englishText: voice.englishText,
      translated: voice.translated,
      rejectReason: voice.rejectReason,
    });
  } catch (error) {
    return fromError(error);
  }
}
