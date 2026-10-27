import "server-only";
import { prisma } from "./db";
import type { BookCardData } from "@/components/book-card";

type Where = NonNullable<Parameters<typeof prisma.book.findMany>[0]>["where"];

/** Books as card data with counts of visible voices and their countries. */
export async function bookCards(where: Where): Promise<BookCardData[]> {
  const books = await prisma.book.findMany({
    where,
    orderBy: [{ featured: "desc" }, { updatedAt: "desc" }],
    select: { id: true, slug: true, title: true, question: true, type: true, status: true, closesAt: true },
  });
  if (books.length === 0) return [];
  const voices = await prisma.voice.findMany({
    where: { bookId: { in: books.map((book) => book.id) }, hidden: false, status: { in: ["READY", "NEEDS_YOU", "PROCESSING"] } },
    select: { bookId: true, countryCode: true },
  });
  return books.map((book) => {
    const mine = voices.filter((voice) => voice.bookId === book.id);
    return { ...book, voices: mine.length, countries: new Set(mine.map((voice) => voice.countryCode).filter(Boolean)).size };
  });
}
