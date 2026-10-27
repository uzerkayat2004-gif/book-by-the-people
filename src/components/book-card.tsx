import Link from "next/link";
import { BookCover } from "@/components/book-cover";
import { releaseLabel } from "@/lib/stage";

export type BookCardData = {
  id: string;
  slug: string;
  title: string;
  question: string;
  type: string;
  status: string;
  closesAt: Date | null;
  voices: number;
  countries: number;
};

const MODE: Record<string, string> = { SOLO: "Solo", INVITED: "Invited", OPEN: "Open", FAMOUS: "Famous" };

export function statusLine(book: Pick<BookCardData, "status" | "closesAt" | "type">) {
  if (book.status === "PUBLISHED") return "Released";
  if (book.status === "COLLECTING") return book.closesAt ? `Voices close ${releaseLabel(book.closesAt).split(" · ")[0]}` : "Taking voices";
  if (book.status === "CLOSED") return "Voices closed · being written";
  return "In review";
}

/** A book tile with a mini cover. `href` decides where it opens (reader page or Studio). */
export function BookCard({ book, href, cta }: { book: BookCardData; href: string; cta?: string }) {
  return (
    <Link href={href} className="bcard">
      <span className="bcard__cover">
        <BookCover compact title={book.title} question={book.question} people={book.voices} countries={book.countries} names={[book.title]} />
      </span>
      <span className="bcard__body">
        <span className="bcard__chips">
          <span className={`modechip modechip--${book.type.toLowerCase()}`}>{MODE[book.type] ?? book.type}</span>
          <span className="bcard__status">{statusLine(book)}</span>
        </span>
        <b className="bcard__title">{book.title}</b>
        <span className="bcard__q">{book.question}</span>
        <span className="bcard__meta">
          {book.voices} {book.voices === 1 ? "voice" : "voices"}
          {book.countries ? ` · ${book.countries} ${book.countries === 1 ? "country" : "countries"}` : ""}
          {cta ? <em>{cta} →</em> : null}
        </span>
      </span>
    </Link>
  );
}

export function NewBookCard() {
  return (
    <Link href="/books/new" className="bcard bcard--new">
      <span className="bcard__plus" aria-hidden>
        +
      </span>
      <b>New book</b>
      <span className="bcard__q">Ask a question. People answer by voice. AI writes the book.</span>
    </Link>
  );
}
