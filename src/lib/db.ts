import "server-only";
import path from "node:path";
import { PrismaClient } from "@/generated/prisma/client";

const configured = process.env.DATABASE_URL ?? "file:./data/bbtp.db";
if (configured.startsWith("file:") && !configured.startsWith("file:/") && !configured.startsWith("file:\\\\")) {
  process.env.DATABASE_URL = `file:${path.resolve(/*turbopackIgnore: true*/ process.cwd(), configured.slice("file:".length))}`;
}

// The sealed per-book AI key never leaves the server by accident: it is omitted
// from every query unless code selects it on purpose (src/lib/ai/keys.ts).
function makeClient() {
  return new PrismaClient({ omit: { book: { aiKeyCipher: true } } });
}

const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof makeClient> };

export const prisma = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
