import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { libraryWhere, openWhere } from "@/lib/public-books";
import { siteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

/** Public pages, plus every listed book (open or released). Unlisted and invite-only books never appear. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const fixed = ["", "/books", "/library", "/about", "/privacy", "/terms"].map((path) => ({ url: `${base}${path}`, changeFrequency: "daily" as const }));
  const books = await prisma.book
    .findMany({ where: { OR: [{ ...libraryWhere }, { ...openWhere, status: { in: [...openWhere.status.in] } }] }, select: { slug: true, updatedAt: true }, take: 500 })
    .catch(() => []);
  return [...fixed, ...books.map((book) => ({ url: `${base}/b/${book.slug}`, lastModified: book.updatedAt }))];
}
