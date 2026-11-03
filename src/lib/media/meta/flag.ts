/**
 * HACKATHON_META_ONLY (default on): media pickers offer only Meta models. Set HACKATHON_META_ONLY=0 to bring
 * every saved provider and the built-in voice back. Nothing is deleted either way.
 */
export function mediaMetaOnly(): boolean {
  const raw = (process.env.HACKATHON_META_ONLY ?? "1").trim().toLowerCase();
  return !["0", "false", "off", "no"].includes(raw);
}
