export const maxDuration = 60;
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError, jsonError } from "@/lib/http";
import { ownedBook } from "@/lib/services/books";
import { advanceTranslations, setReleaseLanguages, translationStates } from "@/lib/services/translations";

const schema = z.object({
  languages: z.array(z.string().max(12)).max(20).optional(),
  run: z.boolean().optional(),
  retry: z.boolean().optional(),
});

/** Release languages: which ones, and how far each translation is. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    await ownedBook(id, user.id);
    return NextResponse.json({ languages: await translationStates(id) });
  } catch (error) {
    return fromError(error);
  }
}

/** Save the release languages and/or translate a bit more of the released book (call again until all are ready). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return jsonError("Pick languages from the list.");
    await ownedBook(id, user.id);
    if (parsed.data.languages) await setReleaseLanguages(id, user.id, parsed.data.languages);
    const languages = parsed.data.run ? await advanceTranslations(id, 40_000, Boolean(parsed.data.retry)) : await translationStates(id);
    return NextResponse.json({ languages });
  } catch (error) {
    return fromError(error);
  }
}
