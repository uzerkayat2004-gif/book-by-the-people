import { getConfig } from "./config";

/**
 * Sends one email. Two free ways, neither needs a domain of your own:
 * - SMTP_URL: any SMTP account, e.g. a Gmail address with an app password
 *   (smtps://you%40gmail.com:APP_PASSWORD@smtp.gmail.com:465) or Brevo's free plan.
 * - RESEND_API_KEY: Resend. Without your own domain it only delivers to your own inbox.
 */
export type Mail = { to: string; subject: string; text: string; html?: string };

export function canSendEmail(): boolean {
  const cfg = getConfig();
  return Boolean(cfg.smtpUrl || (cfg.resendApiKey && cfg.emailFrom));
}

export async function sendMail(mail: Mail): Promise<boolean> {
  const cfg = getConfig();
  if (cfg.smtpUrl) {
    try {
      const { createTransport } = await import("nodemailer");
      const transport = createTransport({ url: cfg.smtpUrl, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 20_000 });
      const from = cfg.emailFrom || smtpUser(cfg.smtpUrl);
      await transport.sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
      return true;
    } catch {
      return false;
    }
  }
  if (cfg.resendApiKey && cfg.emailFrom) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${cfg.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: cfg.emailFrom, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
    }).catch(() => null);
    return Boolean(response?.ok);
  }
  return false;
}

/** The SMTP login doubles as the sender when EMAIL_FROM is empty (Gmail sends as that address anyway). */
function smtpUser(url: string): string {
  try {
    return `Book by the People <${decodeURIComponent(new URL(url).username)}>`;
  } catch {
    return "";
  }
}
