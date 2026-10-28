import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertSameOrigin, fromError } from "@/lib/http";
import { clientIp, jsonError } from "@/lib/http";
import { hourly } from "@/lib/rate-limit";
import { votePoll } from "@/lib/services/books";

const schema = z.object({ optionId: z.string() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    if (!hourly(`poll:${clientIp(request)}`, 60)) return jsonError("Too many votes from here. Try again later.", 429);
    const { id } = await context.params;
    const parsed = schema.parse(await request.json());
    const jar = await cookies();
    let voter = jar.get("bbtp_voter")?.value;
    if (!voter) {
      voter = randomBytes(16).toString("hex");
      jar.set("bbtp_voter", voter, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    await votePoll(id, parsed.optionId, voter);
    const options = await prisma.pollOption.findMany({
      where: { bookId: id },
      orderBy: { position: "asc" },
      include: { _count: { select: { votes: true } } },
    });
    return NextResponse.json({
      options: options.map((option) => ({ id: option.id, label: option.label, votes: option._count.votes })),
      yourVote: parsed.optionId,
    });
  } catch (error) {
    return fromError(error);
  }
}
