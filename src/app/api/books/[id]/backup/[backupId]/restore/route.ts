import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { assertSameOrigin, fromError } from "@/lib/http";
import { restoreBackup } from "@/lib/services/backups";

export async function POST(request: Request, context: { params: Promise<{ id: string; backupId: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  try {
    const user = await requireApiUser();
    const { id, backupId } = await context.params;
    return NextResponse.json(await restoreBackup(id, user.id, backupId));
  } catch (error) {
    return fromError(error);
  }
}
