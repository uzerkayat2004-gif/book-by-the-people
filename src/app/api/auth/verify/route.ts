import { publicOrigin } from "@/lib/http";
import { NextResponse } from "next/server";
import { createSession, safeNextPath, upsertUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = publicOrigin(request);
  const token = url.searchParams.get("token");
  const next = safeNextPath(url.searchParams.get("next"));
  if (!token) return NextResponse.redirect(new URL("/sign-in?error=link", origin));
  const link = await prisma.magicLink.findUnique({ where: { token } });
  if (!link || link.usedAt || link.expiresAt.getTime() < Date.now()) {
    return NextResponse.redirect(new URL("/sign-in?error=expired", origin));
  }
  const user = await upsertUser(link.email);
  await prisma.magicLink.update({ where: { id: link.id }, data: { usedAt: new Date() } });
  await createSession(user.id);
  return NextResponse.redirect(new URL(next, origin));
}
