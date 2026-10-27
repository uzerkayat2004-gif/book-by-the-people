import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";

export async function GET(request: Request) {
  const cfg = getConfig();
  const url = new URL(request.url);
  if (!cfg.googleClientId || !cfg.googleClientSecret) {
    return NextResponse.redirect(new URL("/sign-in?error=google", url.origin));
  }
  const state = randomBytes(16).toString("hex");
  const redirectUri = `${url.origin}/api/auth/google/callback`;
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", cfg.googleClientId);
  auth.searchParams.set("redirect_uri", redirectUri);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", "openid email profile");
  auth.searchParams.set("state", state);
  const response = NextResponse.redirect(auth);
  response.cookies.set("bbtp_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  const next = url.searchParams.get("next") ?? "";
  if (next.startsWith("/") && !next.startsWith("//")) {
    response.cookies.set("bbtp_oauth_next", next, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 600,
    });
  }
  return response;
}
