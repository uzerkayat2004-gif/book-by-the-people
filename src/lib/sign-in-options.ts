import "server-only";
import { getConfig } from "./config";
import { canSendEmail } from "./mailer";

/**
 * One rule for every sign-in box (Sign in, Speak, a book's voice page): Google when it is set up;
 * "Email me a link" only when Google is off or the site can really send that email.
 */
export function signInOptions() {
  const cfg = getConfig();
  const google = Boolean(cfg.googleClientId && cfg.googleClientSecret);
  return { google, email: !google || canSendEmail() || cfg.exposeMagicLinks };
}
