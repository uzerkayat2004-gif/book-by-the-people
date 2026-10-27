import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";

export async function GET() {
  const cfg = getConfig();
  return NextResponse.json({
    ok: true,
    aiMode: cfg.aiMode,
    transcribeModel: cfg.transcribeModel,
    writerModel: cfg.writerModel,
  });
}
