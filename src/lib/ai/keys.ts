import "server-only";
import { prisma } from "../db";
import { getConfig } from "../config";
import { openKey } from "../secret-box";

/**
 * The key a book's AI calls use: the creator's own key for that book first,
 * then the server's META_API_KEY. Returns "" when there is none.
 */
export async function bookAiKey(bookId: string | null | undefined): Promise<string> {
  if (bookId) {
    const book = await prisma.book.findUnique({ where: { id: bookId }, select: { aiKeyCipher: true } });
    if (book?.aiKeyCipher) return openKey(book.aiKeyCipher);
  }
  return getConfig().metaApiKey;
}

export const MISSING_KEY =
  "No AI key for this book. Add your key in Book settings → Your AI key (it stays encrypted on the server), or set META_API_KEY, or run with AI_MODE=mock.";
