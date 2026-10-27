import "dotenv/config";
import path from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
if (process.env.DATABASE_URL?.startsWith("file:./")) process.env.DATABASE_URL = `file:${path.resolve(process.env.DATABASE_URL.slice(5))}`;
const p = new PrismaClient({ omit: { book: { aiKeyCipher: true } } });
async function main() {
  const books = await p.book.findMany({ include: { _count: { select: { voices: true, backups: true, drafts: true } }, creator: { select: { email: true } } } });
  for (const b of books) console.log(b.id, b.slug, b.type, b.status, b.creator.email, b.featured ? "featured" : "", JSON.stringify(b._count), b.closesAt?.toISOString() ?? "-", b.audiobookKey ?? "-");
}
main().finally(() => p.$disconnect());
