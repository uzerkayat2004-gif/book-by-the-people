import { requireApiUser } from "@/lib/auth";
import { fromError } from "@/lib/http";
import { readBackup } from "@/lib/services/backups";

/** Download one backup as JSON (no audio, no secrets). */
export async function GET(_request: Request, context: { params: Promise<{ id: string; backupId: string }> }) {
  try {
    const user = await requireApiUser();
    const { id, backupId } = await context.params;
    const backup = await readBackup(id, user.id, backupId);
    const body = backup.snapshot || JSON.stringify({ version: 1, note: backup.note, voices: backup.voiceCount });
    return new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="backup-${backup.createdAt.toISOString().slice(0, 10)}-${backup.id.slice(-6)}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return fromError(error);
  }
}
