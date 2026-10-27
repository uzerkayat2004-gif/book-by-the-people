import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertSameOrigin, fromError } from "@/lib/http";
import { AGE_BANDS } from "@/lib/regions";

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  handle: z.string().trim().max(15).optional().default(""),
  ageBand: z.string().optional().default(""),
  countryCode: z.string().trim().max(2).optional().default(""),
  region: z.string().trim().max(80).optional().default(""),
});

export async function PATCH(request: Request) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const parsed = schema.parse(await request.json());
    const ageBand = AGE_BANDS.includes(parsed.ageBand as (typeof AGE_BANDS)[number]) ? parsed.ageBand : "";
    const saved = await prisma.user.update({
      where: { id: user.id },
      data: {
        name: parsed.name,
        handle: parsed.handle.replace(/^@/, ""),
        ageBand,
        countryCode: parsed.countryCode.toUpperCase(),
        region: parsed.region,
      },
    });
    return NextResponse.json({ id: saved.id, name: saved.name });
  } catch (error) {
    return fromError(error);
  }
}
