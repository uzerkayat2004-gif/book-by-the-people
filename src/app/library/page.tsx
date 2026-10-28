import Link from "next/link";
import { OpenNow, ReleasedGrid } from "@/components/shelf";
import { openBooks, releasedBooks } from "@/lib/public-books";

export const dynamic = "force-dynamic";

export const metadata = { title: "Library", description: "Every released book, written from people's voices. Read, listen and watch." };

export default async function LibraryPage() {
  const [books, open] = await Promise.all([releasedBooks(), openBooks(null, 6)]);
  const voices = books.reduce((sum, book) => sum + book.voices, 0);
  return (
    <main className="page explore library">
      <div className="wrap library__top">
        <p className="label">Released books</p>
        <h1 className="explore__h">Library</h1>
        <p className="lead">
          {books.length
            ? `${books.length} ${books.length === 1 ? "book" : "books"} · ${voices.toLocaleString("en-US")} voices. Every past book stays here to read, listen and watch.`
            : "Released books will live here. The first one is still taking voices."}
        </p>
        {books.length ? (
          <div className="library__list">
            <ReleasedGrid books={books} wide testId="library-list" />
          </div>
        ) : (
          <div className="card bl lib-empty">
            <b>No released books yet.</b>
            <span>When a book is released it appears here for good.</span>
          </div>
        )}
      </div>
      <OpenNow books={open} heading="Open now · add your voice" />
      <p className="ownbook wrap">
        <Link href="/books/new">Start your own book</Link>
        {" · "}
        <Link href="/explore">Explore</Link>
      </p>
    </main>
  );
}
