import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError } from "@/lib/http";
import { createBackup } from "@/lib/services/backups";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const backup = await createBackup(id, user.id);
    return NextResponse.json({ id: backup.id, voices: backup.voiceCount });
  } catch (error) {
    return fromError(error);
  }
}
