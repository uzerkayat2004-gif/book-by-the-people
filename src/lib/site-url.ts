/** The public address of the site, for links in metadata, the sitemap and share cards. */
export function siteUrl(): string {
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prod) return `https://${prod.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  const app = (process.env.APP_URL || "").replace(/\/$/, "");
  return app || "http://127.0.0.1:43123";
}
