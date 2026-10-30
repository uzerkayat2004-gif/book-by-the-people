import { jsonError } from "@/lib/http";

/** Start words are gone: people just write. */
export async function POST() {
  return jsonError("Start words are no longer used. Just write your answer.", 410);
}
