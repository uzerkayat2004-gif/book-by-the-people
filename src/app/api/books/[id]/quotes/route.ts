import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError } from "@/lib/http";
import { addSourcedQuote } from "@/lib/services/voices";

const schema = z.object({
  speaker: z.string(),
  text: z.string(),
  sourceUrl: z.string(),
  sourceTitle: z.string().optional(),
  sourceDate: z.string().optional(),
  language: z.string().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const parsed = schema.parse(await request.json());
    const quote = await addSourcedQuote({
      bookId: id,
      userId: user.id,
      speaker: parsed.speaker,
      text: parsed.text,
      sourceUrl: parsed.sourceUrl,
      sourceTitle: parsed.sourceTitle ?? "",
      sourceDate: parsed.sourceDate ?? "",
      language: parsed.language ?? "en",
    });
    return NextResponse.json({ id: quote.id });
  } catch (error) {
    return fromError(error);
  }
}
