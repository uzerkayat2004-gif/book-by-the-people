import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { prisma } from "@/lib/db";
import { ffmpegBin, speechEngine } from "@/lib/media/tools";
import { checkStorage } from "@/lib/storage";
import { localModelsOff } from "@/lib/ai/local-gate";
import { canStoreKeys } from "@/lib/secret-box";

export const dynamic = "force-dynamic";

// Health check for the host. 200 when the database answers, 503 when it does not.
// ?deep=1 also writes, reads and deletes a tiny file in storage.
// Nothing here returns keys, URLs or other settings values.
export async function GET(request: Request) {
  const cfg = getConfig();
  const deep = new URL(request.url).searchParams.get("deep") === "1";
  let database = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = true;
  } catch {
    database = false;
  }
  const [ffmpeg, speech, storage] = await Promise.all([
    ffmpegBin().then(Boolean).catch(() => false),
    speechEngine().catch(() => null),
    deep ? checkStorage() : Promise.resolve(null),
  ]);
  const ok = database && (!storage || storage.ok);
  return NextResponse.json(
    {
      ok,
      database,
      databaseKind: (process.env.DATABASE_URL ?? "").startsWith("postgres") ? "postgres" : "sqlite",
      storage: storage ?? { driver: cfg.storageDriver === "s3" ? "s3" : "local" },
      ffmpeg,
      speech: speech ?? false,
      localModels: !localModelsOff(),
      aiMode: cfg.aiMode,
      serverKey: Boolean(cfg.metaApiKey),
      canSaveKeys: canStoreKeys(),
      transcribeModel: cfg.transcribeModel,
      writerModel: cfg.writerModel,
    },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
