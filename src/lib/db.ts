import "server-only";
import path from "node:path";
import { PrismaClient } from "@/generated/prisma/client";

const configured = process.env.DATABASE_URL ?? "file:./data/bbtp.db";
if (configured.startsWith("file:") && !configured.startsWith("file:/") && !configured.startsWith("file:\\\\")) {
  process.env.DATABASE_URL = `file:${path.resolve(process.cwd(), configured.slice("file:".length))}`;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
