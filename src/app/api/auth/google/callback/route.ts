import { publicOrigin } from "@/lib/http";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSession, upsertUser } from "@/lib/auth";
import { getConfig } from "@/lib/config";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = publicOrigin(request);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const expected = jar.get("bbtp_oauth_state")?.value;
  jar.delete("bbtp_oauth_state");
  const wanted = jar.get("bbtp_oauth_next")?.value ?? "";
  jar.delete("bbtp_oauth_next");
  // Only paths on this site, so the link cannot send people elsewhere.
  const next = wanted.startsWith("/") && !wanted.startsWith("//") && !wanted.startsWith("/\\") ? wanted : "/studio";
  if (!code || !state || !expected || state !== expected) {
    return NextResponse.redirect(new URL("/sign-in?error=google", origin));
  }
  const cfg = getConfig();
  const redirectUri = `${origin}/api/auth/google/callback`;
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.googleClientId,
      client_secret: cfg.googleClientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenResponse.ok) return NextResponse.redirect(new URL("/sign-in?error=google", origin));
  const token = (await tokenResponse.json()) as { access_token?: string };
  if (!token.access_token) return NextResponse.redirect(new URL("/sign-in?error=google", origin));
  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!profileResponse.ok) return NextResponse.redirect(new URL("/sign-in?error=google", origin));
  const profile = (await profileResponse.json()) as { email?: string; name?: string; picture?: string };
  if (!profile.email) return NextResponse.redirect(new URL("/sign-in?error=google", origin));
  const user = await upsertUser(profile.email, profile.name);
  if (profile.picture && !user.image) {
    const { prisma } = await import("@/lib/db");
    await prisma.user.update({ where: { id: user.id }, data: { image: profile.picture } });
  }
  await createSession(user.id);
  return NextResponse.redirect(new URL(next, origin));
}
