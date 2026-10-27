import Link from "next/link";
import { BookCard } from "@/components/book-card";
import { bookCards } from "@/lib/book-cards";

export const dynamic = "force-dynamic";

export const metadata = { title: "Explore books · Book by the People" };

export default async function ExplorePage() {
  // Public books only: invited books appear once they are released.
  const books = await bookCards({
    OR: [{ type: { in: ["OPEN", "FAMOUS", "SOLO"] } }, { type: "INVITED", status: "PUBLISHED" }],
  });
  const open = books.filter((book) => book.status !== "PUBLISHED");
  const released = books.filter((book) => book.status === "PUBLISHED");
  return (
    <main className="page explore">
      <div className="exwrap">
        <p className="label">Every book here was written from voices</p>
        <h1 className="explore__h">Explore</h1>
        <p className="lead">Open books take anyone&apos;s voice. Famous books are built only from real, sourced quotes. Invited books show up once they are released.</p>
        {released.length ? (
          <>
            <h2 className="explore__sec">Released · read, listen, watch</h2>
            <div className="bgrid">
              {released.map((book) => (
                <BookCard key={book.id} book={book} href={`/b/${book.slug}/read`} cta="Read" />
              ))}
            </div>
          </>
        ) : null}
        {open.length ? (
          <>
            <h2 className="explore__sec">Taking voices</h2>
            <div className="bgrid">
              {open.map((book) => (
                <BookCard key={book.id} book={book} href={`/b/${book.slug}`} cta={book.type === "OPEN" ? "Add your voice" : "Open"} />
              ))}
            </div>
          </>
        ) : null}
        {books.length === 0 ? <div className="card bl">No books yet.</div> : null}
        <div className="explore__own">
          <div>
            <b>Have a question worth a book?</b>
            <span>It&apos;s free. Pick who speaks, set a release date, and the AI writes it from their voices.</span>
          </div>
          <Link className="btn btn--red" href="/books/new">
            Start your own book
          </Link>
        </div>
      </div>
    </main>
  );
}
