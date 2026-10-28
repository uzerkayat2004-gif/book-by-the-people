import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, fromError } from "@/lib/http";
import { clientIp, jsonError } from "@/lib/http";
import { hourly } from "@/lib/rate-limit";
import { issueChallenge } from "@/lib/services/voices";

const schema = z.object({ language: z.string(), preferred: z.string().optional() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    if (!hourly(`challenge:${clientIp(request)}`, 120)) return jsonError("Too many tries from here. Try again later.", 429);
    const { id } = await context.params;
    const parsed = schema.parse(await request.json());
    const challenge = await issueChallenge(id, parsed.language, parsed.preferred);
    return NextResponse.json(challenge);
  } catch (error) {
    return fromError(error);
  }
}
