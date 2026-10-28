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
  let databaseError: string | undefined;
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = true;
  } catch (err) {
    database = false;
    // Only the error class and Prisma code: never the message, which can hold the host or user.
    const e = err as { name?: string; errorCode?: string; code?: string };
    const msg = String((err as Error)?.message ?? "");
    const hint = /query engine|libquery|could not locate|shared library/i.test(msg)
      ? "engine"
      : /can't reach|timed out|ECONN|ENOTFOUND/i.test(msg)
        ? "unreachable"
        : /authentication|password/i.test(msg)
          ? "auth"
          : /url|connection string|parse|scheme/i.test(msg)
            ? "url"
            : "other";
    databaseError = [e?.name, e?.errorCode ?? e?.code, hint].filter(Boolean).join(" ");
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
      ...(databaseError ? { databaseError } : {}),
      databaseKind: (process.env.DATABASE_URL ?? "").startsWith("postgres") ? "postgres" : "sqlite",
      storage: storage ?? { driver: cfg.storageDriver },
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
