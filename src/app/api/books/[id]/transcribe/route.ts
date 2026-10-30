import { jsonError } from "@/lib/http";

/** Speaking is off: answers are written on the page. Audio is never accepted. */
function gone() {
  return jsonError("Speaking is off. Write your answer on the page.", 410);
}

export const POST = gone;
export const GET = gone;
