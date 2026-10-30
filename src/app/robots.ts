import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/studio", "/admin", "/me", "/sign-in", "/speak", "/books/new", "/*/voice"] }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
