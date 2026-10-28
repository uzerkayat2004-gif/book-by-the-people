import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError, jsonError } from "@/lib/http";
import { localAction, localStatus } from "@/lib/ai/local-service";
import { LOCAL_OFF_MESSAGE, localModelsOff } from "@/lib/ai/local-gate";
import { LOCAL_MODELS } from "@/lib/ai/local-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Local Meta models: folder, free space, Ollama, downloads in progress. */
export async function GET() {
  try {
    const user = await requireApiUser();
    if (localModelsOff()) return NextResponse.json({ disabled: true, message: LOCAL_OFF_MESSAGE, models: LOCAL_MODELS });
    return NextResponse.json(await localStatus(user.id));
  } catch (error) {
    return fromError(error);
  }
}

/** { action: "download" | "cancel" | "remove" | "clear", modelId, engine: "builtin" | "ollama" } */
export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    if (localModelsOff()) return jsonError(LOCAL_OFF_MESSAGE, 400);
    const body = (await request.json().catch(() => ({}))) as { action?: string; modelId?: string; engine?: string };
    try {
      await localAction(user.id, body);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "That did not work.", 400);
    }
    return NextResponse.json(await localStatus(user.id));
  } catch (error) {
    return fromError(error);
  }
}
