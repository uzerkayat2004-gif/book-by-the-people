import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "./db";

const COOKIE = "bbtp_session";
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
const THIRTY_MINUTES = 30 * 60 * 1000;

export async function requireApiUser() {
  const user = await getCurrentUser();
  if (!user) {
    const { AppError } = await import("./errors");
    throw new AppError("Sign in first.", 401);
  }
  return user;
}

export async function getCurrentUser() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!session || session.expiresAt.getTime() <= Date.now()) return null;
  return session.user;
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + THIRTY_DAYS);
  await prisma.session.create({ data: { userId, token, expiresAt } });
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { token } });
  jar.delete(COOKIE);
}

export async function upsertUser(email: string, name?: string | null) {
  const normalized = email.trim().toLowerCase();
  return prisma.user.upsert({
    where: { email: normalized },
    update: name ? { name } : {},
    create: { email: normalized, name: name?.trim() || normalized.split("@")[0] },
  });
}

export async function createMagicLink(email: string) {
  const token = randomBytes(24).toString("hex");
  await prisma.magicLink.create({
    data: {
      email: email.trim().toLowerCase(),
      token,
      expiresAt: new Date(Date.now() + THIRTY_MINUTES),
    },
  });
  return token;
}

export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/studio";
  return value;
}
