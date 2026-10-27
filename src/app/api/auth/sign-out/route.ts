import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { assertSameOrigin, fromError } from "@/lib/http";

export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    await destroySession();
    return NextResponse.redirect(new URL("/", request.url), 303);
  } catch (error) {
    return fromError(error);
  }
}
