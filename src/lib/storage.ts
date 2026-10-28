import "server-only";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, readFile, rm, writeFile } from "@/lib/runtime-fs";
import { createHmac } from "node:crypto";
import path from "node:path";
import { getConfig } from "./config";

function safeKey(key: string): string {
  const base = path.basename(key).replace(/[^a-zA-Z0-9._-]/g, "");
  if (!base) throw new Error("Invalid audio key.");
  return base;
}

async function localPath(key: string): Promise<string> {
  const dir = path.resolve(/*turbopackIgnore: true*/ getConfig().localStorageDir);
  await mkdir(dir, { recursive: true });
  return path.join(dir, safeKey(key));
}

function s3(): { client: S3Client; bucket: string } {
  const cfg = getConfig().s3;
  if (!cfg.bucket || !cfg.accessKeyId || !cfg.secretAccessKey) {
    throw new Error("S3 storage is selected, but S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY are missing.");
  }
  const client = new S3Client({
    region: cfg.region || "auto",
    endpoint: cfg.endpoint || undefined,
    forcePathStyle: cfg.forcePathStyle,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
  return { client, bucket: cfg.bucket };
}

/**
 * Vercel Blob (free on Hobby: 1 GB, 10 GB transfer a month). The store is public, so each file sits under a
 * secret-derived folder nobody can guess from the book or voice id. Media links still go through this app.
 */
function blobPath(key: string): string {
  const secret = process.env.BLOB_PATH_SECRET || process.env.AI_KEY_SECRET || process.env.BLOB_READ_WRITE_TOKEN || "bbtp";
  const tag = createHmac("sha256", secret).update(safeKey(key)).digest("hex").slice(0, 24);
  return `bbtp/${tag}/${safeKey(key)}`;
}

async function blobSdk() {
  return import("@vercel/blob");
}

/** The direct Blob URL for a stored file, or null for local disk and S3. Big media redirects there. */
export async function publicAudioUrl(key: string, download = false): Promise<string | null> {
  if (getConfig().storageDriver !== "blob") return null;
  const { head } = await blobSdk();
  const info = await head(blobPath(key));
  return download ? info.downloadUrl : info.url;
}

export async function putAudio(key: string, body: Buffer, mime: string): Promise<void> {
  if (getConfig().storageDriver === "blob") {
    const { put } = await blobSdk();
    await put(blobPath(key), body, { access: "public", contentType: mime, addRandomSuffix: false, allowOverwrite: true });
    return;
  }
  if (getConfig().storageDriver === "s3") {
    const { client, bucket } = s3();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: safeKey(key),
        Body: body,
        ContentType: mime,
      }),
    );
    return;
  }
  await writeFile(await localPath(key), body);
}

export async function getAudio(key: string): Promise<Buffer> {
  if (getConfig().storageDriver === "blob") {
    const { get } = await blobSdk();
    const result = await get(blobPath(key), { access: "public", useCache: false });
    if (!result || result.statusCode !== 200) throw new Error("The audio object was not found.");
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  }
  if (getConfig().storageDriver === "s3") {
    const { client, bucket } = s3();
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: safeKey(key) }));
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) throw new Error("The audio object was empty.");
    return Buffer.from(bytes);
  }
  return readFile(await localPath(key));
}

export async function deleteAudio(key: string): Promise<void> {
  if (getConfig().storageDriver === "blob") {
    const { del } = await blobSdk();
    await del(blobPath(key));
    return;
  }
  if (getConfig().storageDriver === "s3") {
    const { client, bucket } = s3();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: safeKey(key) }));
    return;
  }
  await rm(await localPath(key), { force: true });
}

/** Writes, reads back and deletes a tiny object. Used by /api/health?deep=1. */
export async function checkStorage(): Promise<{ ok: boolean; driver: "local" | "s3" | "blob"; error?: string }> {
  const driver = getConfig().storageDriver;
  const key = `health-${Date.now().toString(36)}.txt`;
  try {
    await putAudio(key, Buffer.from("ok"), "text/plain");
    const back = await getAudio(key);
    await deleteAudio(key);
    return back.toString() === "ok" ? { ok: true, driver } : { ok: false, driver, error: "read back a different value" };
  } catch (error) {
    return { ok: false, driver, error: error instanceof Error ? error.message.slice(0, 160) : "storage error" };
  }
}
