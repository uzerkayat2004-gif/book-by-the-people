import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError } from "./errors";

export function jsonError(message: string, status = 400, code?: string) {
  return NextResponse.json(code ? { error: message, code } : { error: message }, { status });
}

export function assertSameOrigin(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const host = request.headers.get("host");
  try {
    if (new URL(origin).host !== host) return jsonError("That request came from somewhere else.", 403);
  } catch {
    return jsonError("That request came from somewhere else.", 403);
  }
  return null;
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "local";
}

export function fromError(error: unknown) {
  if (error instanceof AppError) return jsonError(error.message, error.status, error.code);
  if (error instanceof ZodError) return jsonError("Check the form and try again.");
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return jsonError(message, 500);
}

/**
 * The site's public address for links and redirects. Behind a host's proxy the request URL can be
 * the internal http address, so production uses APP_URL when it is set.
 */
export function publicOrigin(request: Request): string {
  const configured = process.env.APP_URL?.trim();
  if (process.env.NODE_ENV === "production" && configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // fall through to the request's own origin
    }
  }
  return new URL(request.url).origin;
}
