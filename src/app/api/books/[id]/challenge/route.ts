import { jsonError } from "@/lib/http";

/** Start words are gone: people just start speaking or typing. */
export async function POST() {
  return jsonError("Start words are no longer used. Just start speaking.", 410);
}
