import Link from "next/link";
import { ReleasedGrid } from "@/components/shelf";
import { Pager, SearchBar } from "@/components/pager";
import { browseLibrary } from "@/lib/public-books";

export const dynamic = "force-dynamic";

export const metadata = { title: "Library", description: "Every released book, written from people's voices. Read, listen and watch." };

/** Released books only. A book shows up here the moment its owner releases it, and never before. */
export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const query = await searchParams;
  const result = await browseLibrary({ q: query.q, page: query.page });
  return (
    <main className="page explore library">
      <div className="wrap library__top">
        <p className="label">Released books</p>
        <h1 className="explore__h">Library</h1>
        <p className="lead">
          {result.total
            ? `${result.total.toLocaleString("en-US")} ${result.total === 1 ? "book" : "books"}${result.q ? " found" : ""}. Read, listen, watch.`
            : result.q
              ? "Nothing matches."
              : "Released books live here. None yet."}
        </p>
        <SearchBar action="/library" q={result.q} placeholder="Search the Library" />
        {result.books.length ? (
          <div className="library__list">
            <ReleasedGrid books={result.books} wide testId="library-list" />
          </div>
        ) : (
          <div className="card bl lib-empty">
            <b>{result.q ? "No released book matches." : "No released books yet."}</b>
            <span>{result.q ? <Link href="/library">Clear the search</Link> : "A book appears here once its owner releases it."}</span>
          </div>
        )}
        <Pager base="/library" page={result.page} pages={result.pages} params={{ q: result.q }} />
      </div>
      <p className="ownbook wrap">
        <Link href="/books">Books being written</Link>
        {" · "}
        <Link href="/books/new">Start your own book</Link>
      </p>
    </main>
  );
}
