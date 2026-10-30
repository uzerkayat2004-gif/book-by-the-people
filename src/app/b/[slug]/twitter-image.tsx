import { prisma } from "@/lib/db";
import { OG_SIZE, ogCard } from "@/lib/og/card";

export const alt = "A Book by the People question";
export const size = OG_SIZE;
export const contentType = "image/png";

/** Share card for one book: its question only (never anyone's words). */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const book = await prisma.book.findUnique({ where: { slug }, select: { title: true, question: true, status: true } }).catch(() => null);
  if (!book) return ogCard({ kicker: "Book by the People", title: "One question. Everyone answers.", foot: "book-by-the-people" });
  return ogCard({
    kicker: book.status === "PUBLISHED" ? "Out now · Read, listen, watch" : "Taking voices now",
    title: book.question || book.title,
    foot: `${book.title} · Add your voice`,
  });
}
