import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError, jsonError } from "@/lib/http";
import { installFfmpeg, toolsStatus } from "@/lib/media/tools";
import { localModelsOff } from "@/lib/ai/local-gate";

export const maxDuration = 300;

/** Audio tools on this computer: ffmpeg and the audiobook voice. */
export async function GET() {
  try {
    await requireApiUser();
    return NextResponse.json(await toolsStatus());
  } catch (error) {
    return fromError(error);
  }
}

/** One-click ffmpeg download (about 30 MB). */
export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    await requireApiUser();
    if (localModelsOff()) return jsonError("Audio tools are set up on your own computer, not on the hosted site.", 400);
    try {
      await installFfmpeg();
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "Could not get ffmpeg.", 502);
    }
    return NextResponse.json(await toolsStatus());
  } catch (error) {
    return fromError(error);
  }
}
