import Link from "next/link";
import { OpenNow } from "@/components/shelf";
import { Pager, SearchBar } from "@/components/pager";
import { LANGUAGES } from "@/lib/languages";
import { browseOpenBooks } from "@/lib/public-books";

export const dynamic = "force-dynamic";

export const metadata = { title: "Books being written", description: "Every book taking voices right now. Pick one and add yours." };

/** Every listed book taking voices: search by topic, filter by language, 12 a page. Unlisted books never show here. */
export default async function BooksPage({ searchParams }: { searchParams: Promise<{ q?: string; lang?: string; page?: string }> }) {
  const query = await searchParams;
  const result = await browseOpenBooks({ q: query.q, lang: query.lang, page: query.page });
  const filtered = Boolean(result.q || result.lang);
  return (
    <main className="page explore booksall">
      <div className="wrap booksall__top">
        <p className="label">Taking voices now</p>
        <h1 className="explore__h">Books</h1>
        <p className="lead">
          {result.total.toLocaleString("en-US")} {result.total === 1 ? "book" : "books"} {filtered ? "found" : "being written"}. Pick one, add your voice.
        </p>
        <SearchBar action="/books" q={result.q} placeholder="Search a topic">
          <select className="findbar__lang" name="lang" defaultValue={result.lang} aria-label="Language">
            <option value="">All languages</option>
            {result.languages.map((language) => (
              <option key={language.code} value={language.code}>
                {LANGUAGES.find((item) => item.code === language.code)?.name ?? language.code} · {language.count}
              </option>
            ))}
          </select>
        </SearchBar>
      </div>
      {result.books.length ? (
        <OpenNow books={result.books} heading={filtered ? "Results" : "Newest first"} allLink={false} />
      ) : (
        <div className="wrap">
          <div className="card bl lib-empty">
            <b>{filtered ? "Nothing matches." : "No books are taking voices yet."}</b>
            <span>{filtered ? <Link href="/books">Clear the search</Link> : "Start one. It's free."}</span>
          </div>
        </div>
      )}
      <div className="wrap">
        <Pager base="/books" page={result.page} pages={result.pages} params={{ q: result.q, lang: result.lang }} />
      </div>
      <p className="ownbook wrap">
        <Link href="/books/new">Start your own book</Link>
        {" · "}
        <Link href="/library">Library</Link>
      </p>
    </main>
  );
}
