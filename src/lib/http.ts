import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError } from "./errors";
import { scrubSecrets } from "./scrub";

export function jsonError(message: string, status = 400, code?: string) {
  return NextResponse.json(code ? { error: message, code } : { error: message }, { status });
}

export function assertSameOrigin(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) {
    // Browsers that leave out Origin still say where a request came from. Another site is refused.
    const site = request.headers.get("sec-fetch-site");
    if (site === "cross-site") return jsonError("That request came from somewhere else.", 403);
    return null;
  }
  const host = request.headers.get("host");
  try {
    if (new URL(origin).host !== host) return jsonError("That request came from somewhere else.", 403);
  } catch {
    return jsonError("That request came from somewhere else.", 403);
  }
  return null;
}

export function clientIp(request: Request): string {
  // On Vercel these are set by the platform, so a visitor can't pick their own address.
  const vercel = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  if (vercel) return vercel;
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "local";
}

export function fromError(error: unknown) {
  if (error instanceof AppError) return jsonError(error.message, error.status, error.code);
  if (error instanceof ZodError) return jsonError("Check the form and try again.");
  // Database and other internal errors are not shown; any key-like text is removed from the rest.
  if (error instanceof Error && /^Prisma|^PrismaClient/.test(error.name || error.constructor?.name || "")) {
    return jsonError("Something went wrong. Try again.", 500);
  }
  const message = error instanceof Error ? scrubSecrets(error.message) : "Something went wrong.";
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
