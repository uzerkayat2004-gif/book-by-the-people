import "server-only";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "./config";

function safeKey(key: string): string {
  const base = path.basename(key).replace(/[^a-zA-Z0-9._-]/g, "");
  if (!base) throw new Error("Invalid audio key.");
  return base;
}

async function localPath(key: string): Promise<string> {
  const dir = path.resolve(getConfig().localStorageDir);
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

export async function putAudio(key: string, body: Buffer, mime: string): Promise<void> {
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
  if (getConfig().storageDriver === "s3") {
    const { client, bucket } = s3();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: safeKey(key) }));
    return;
  }
  await rm(await localPath(key), { force: true });
}
