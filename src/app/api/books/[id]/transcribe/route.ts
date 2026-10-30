import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAcceptVoice } from "@/lib/book/lifecycle";
import { prisma } from "@/lib/db";
import { assertSameOrigin, clientIp, jsonError } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { NoSpeechModel, transcribeClip } from "@/lib/ai/speech";
import { recordUsage, spendPaused } from "@/lib/services/spend";
import { cleanClipText } from "@/lib/speech/assemble";
import { wavInfo } from "@/lib/speech/wav";

export const runtime = "nodejs";
export const maxDuration = 60;

/** One clip is at most ~20 s of 16 kHz mono 16-bit audio. */
const MAX_BYTES = 44 + 16000 * 2 * 20;
/** Seconds of audio each contribution may send (in-memory, per server instance), on top of the book's limit. */
const sessionSeconds = new Map<string, { s: number; at: number }>();

function addSeconds(key: string, seconds: number, cap: number): boolean {
  const now = Date.now();
  for (const [k, v] of sessionSeconds) if (now - v.at > 2 * 60 * 60 * 1000) sessionSeconds.delete(k);
  const row = sessionSeconds.get(key) ?? { s: 0, at: now };
  if (row.s + seconds > cap) return false;
  sessionSeconds.set(key, { s: row.s + seconds, at: now });
  return true;
}

/**
 * Speech to words for the Add your voice page. Takes one short WAV clip, returns only its words.
 * The audio is held in memory for this request and then dropped; nothing about it is stored or logged.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  const { id } = await context.params;
  const url = new URL(request.url);
  const language = (url.searchParams.get("lang") ?? "en").slice(0, 16);
  const session = (url.searchParams.get("session") ?? "").replace(/[^\w-]/g, "").slice(0, 40);
  const invite = url.searchParams.get("invite");
  if (!(request.headers.get("content-type") ?? "").startsWith("audio/wav")) return jsonError("Send a WAV clip.", 415);
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BYTES) return jsonError("That clip is too long.", 413);

  const ip = clientIp(request);
  const prod = process.env.NODE_ENV === "production";
  if (!rateLimit(`stt:${ip}`, prod ? 240 : 100_000, 60 * 60 * 1000) || !rateLimit(`stt-burst:${ip}`, prod ? 20 : 100_000, 60 * 1000)) {
    return jsonError("Too much speech from here right now. Wait a minute, or switch to Write.", 429, "rate");
  }

  const book = await prisma.book.findUnique({
    where: { id },
    select: { id: true, type: true, status: true, closesAt: true, creatorId: true, inviteToken: true, maxVoiceSeconds: true },
  });
  if (!book) return jsonError("Book not found.", 404);
  const user = await getCurrentUser();
  const paused = await spendPaused(book.id);
  const gate = canAcceptVoice({
    bookType: book.type,
    status: book.status,
    closesAt: book.closesAt?.getTime() ?? null,
    creatorId: book.creatorId,
    inviteToken: book.inviteToken,
    viewerId: user?.id ?? null,
    providedInvite: invite,
    paused,
  });
  if (!gate.ok) return jsonError(gate.reason, paused ? 409 : 403, paused ? "no-speech" : "closed");

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_BYTES) return jsonError("That clip is too long.", 413);
  const info = wavInfo(bytes);
  if (!info || info.ms < 200) return jsonError("That clip is not a 16 kHz mono WAV.", 400);

  const seconds = info.ms / 1000;
  const cap = (book.maxVoiceSeconds || 600) + 60;
  if (!addSeconds(`${book.id}:${ip}:${session || "none"}`, seconds, cap) || !addSeconds(`${book.id}:${ip}:hour`, seconds, cap * 3)) {
    return jsonError("That's the speaking limit for this answer. Edit your words, then add them.", 429, "limit");
  }

  const started = Date.now();
  try {
    const heard = await transcribeClip({ bookId: book.id, wav: Buffer.from(bytes), language });
    // Timing only: no audio, no words, no keys.
    console.info(`stt ok book=${book.id} provider=${heard.provider} model=${heard.model} audioMs=${info.ms} tookMs=${Date.now() - started}`);
    await recordUsage({ kind: "transcribe-live", provider: heard.provider, model: heard.model, bookId: book.id, audioMs: info.ms }).catch(() => undefined);
    return NextResponse.json({ text: cleanClipText(heard.text, info.ms) });
  } catch (error) {
    if (error instanceof NoSpeechModel) return jsonError("This book has no speech model.", 409, "no-speech");
    const detail = (error instanceof Error ? error.message : "failed").replace(/(key|token|bearer)[=: ]+\S+/gi, "$1=…").slice(0, 300);
    console.warn(`stt failed book=${book.id} audioMs=${info.ms} tookMs=${Date.now() - started} ${detail}`);
    // Never echo provider details (they can include request ids); just say it failed.
    return jsonError("Could not turn that part into words.", 502, "provider");
  }
}
