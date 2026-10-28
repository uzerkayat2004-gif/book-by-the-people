import { NextResponse } from "next/server";
import { z } from "zod";
import { createMagicLink, safeNextPath } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { canSendEmail, sendMail } from "@/lib/mailer";
import { assertSameOrigin, clientIp, fromError, jsonError, publicOrigin } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

const bodySchema = z.object({
  email: z.string().trim().email(),
  next: z.string().optional(),
});

export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    if (!rateLimit(`magic:${clientIp(request)}`, process.env.NODE_ENV === "production" ? 40 : 1000, 60 * 60 * 1000)) {
      return jsonError("Too many sign-in links. Wait a little and try again.", 429);
    }
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return jsonError("Enter a real email address.");
    const token = await createMagicLink(parsed.data.email);
    const next = safeNextPath(parsed.data.next);
    const link = `${publicOrigin(request)}/api/auth/verify?token=${token}&next=${encodeURIComponent(next)}`;
    const cfg = getConfig();
    let delivered = false;
    if (canSendEmail()) {
      delivered = await sendMail({
        to: parsed.data.email,
        subject: "Your link into Book by the People",
        text: `This link opens your studio. It expires in 30 minutes.\n\n${link}\n`,
        html: `<p>This link opens your studio. It expires in 30 minutes.</p><p><a href="${link}">${link}</a></p>`,
      });
      if (!delivered && !cfg.exposeMagicLinks) {
        return jsonError("The sign-in email could not be sent.", 502);
      }
    } else if (!cfg.exposeMagicLinks) {
      return jsonError("Email sign-in is not set up on this site yet.", 503);
    }
    return NextResponse.json({
      ok: true,
      delivered,
      devLink: cfg.exposeMagicLinks ? link : undefined,
    });
  } catch (error) {
    return fromError(error);
  }
}
