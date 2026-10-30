import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { assertSameOrigin, clientIp, fromError, jsonError } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { ingestWords } from "@/lib/services/voices";
import { guestKeyForWrite } from "@/lib/viewer";

/** Words only. Audio or file uploads are not accepted for contributions. */
const schema = z.object({
  text: z.string().max(12000),
  mode: z.enum(["speak", "write"]).default("speak"),
  name: z.string().max(80),
  language: z.string().max(16).default("en"),
  country: z.string().max(4).optional().nullable(),
  handle: z.string().max(40).optional().default(""),
  ageBand: z.string().max(12).optional().default(""),
  region: z.string().max(60).optional().default(""),
  consent: z.boolean(),
  invite: z.string().max(200).optional().nullable(),
  metrics: z
    .object({ activeMs: z.number().optional(), keys: z.number().optional(), spoken: z.number().optional() })
    .optional()
    .default({}),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
      return jsonError("Uploads are off. Speak or type your words on the page.", 415);
    }
    const ip = clientIp(request);
    if (!rateLimit(`voice:${ip}`, process.env.NODE_ENV === "production" ? 20 : 1000, 60 * 60 * 1000)) {
      return jsonError("Too many voices from here. Try again later.", 429);
    }
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return jsonError("Something in the form is missing. Check your name and words.");
    const body = parsed.data;
    const user = await getCurrentUser();
    const voice = await ingestWords({
      bookId: id,
      viewerId: user?.id ?? null,
      // A guest gets a private browser key so they alone (and the owner) can see or delete this voice later.
      guestKey: user ? "" : await guestKeyForWrite(),
      invite: body.invite || null,
      name: body.name,
      language: body.language,
      countryCode: body.country || null,
      handle: body.handle,
      ageBand: body.ageBand,
      region: body.region,
      consent: body.consent,
      text: body.text,
      mode: body.mode,
      metrics: body.metrics,
    });
    return NextResponse.json({ id: voice.id, status: voice.status });
  } catch (error) {
    return fromError(error);
  }
}
