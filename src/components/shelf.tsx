import Link from "next/link";
import { BookCover } from "@/components/book-cover";

export type ShelfOpen = {
  id: string;
  slug: string;
  title: string;
  question: string;
  type: string;
  closesLabel: string | null;
  voices: number;
  countries: number;
};

export type ShelfReleased = {
  id: string;
  slug: string;
  title: string;
  question: string;
  bookNumber: number;
  releasedLabel: string;
  releasedIso: string | null;
  voices: number;
  countries: number;
  chapters: number;
  audio: boolean;
  video: boolean;
};

const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

/** "Also open now": other books taking voices. Each has its own add-voice page. */
export function OpenNow({ books, heading = "Also open now" }: { books: ShelfOpen[]; heading?: string }) {
  if (books.length === 0) return null;
  return (
    <section className="wrap section shelf rv in" aria-labelledby="open-now" data-testid="open-now">
      <div className="shelf__head">
        <h2 id="open-now">{heading}</h2>
        <p>More questions taking voices. Each one becomes its own book.</p>
      </div>
      <div className="opengrid">
        {books.map((book) => (
          <article className="opencard" key={book.id} data-testid="open-card">
            <Link className="opencard__top" href={`/b/${book.slug}`}>
              <span className="opencard__live">
                <i aria-hidden />
                {book.type === "FAMOUS" ? "Collecting quotes" : "Taking voices"}
                {book.closesLabel ? ` · closes ${book.closesLabel}` : ""}
              </span>
              <b className="opencard__t">{book.title}</b>
              <span className="opencard__q">{book.question}</span>
            </Link>
            <div className="opencard__foot">
              <span>
                {plural(book.voices, "voice")}
                {book.countries ? ` · ${plural(book.countries, "country", "countries")}` : ""}
              </span>
              {book.type === "OPEN" ? (
                <Link className="btn btn--red btn--sm opencard__cta" href={`/b/${book.slug}/voice`}>
                  <span className="rec" />
                  Add your voice
                </Link>
              ) : (
                <Link className="btn btn--sm opencard__cta" href={`/b/${book.slug}`}>
                  Open
                </Link>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

/** One released book: cover, title, date, voices, and how to read, listen or watch. */
export function ReleasedCard({ book, wide = false }: { book: ShelfReleased; wide?: boolean }) {
  return (
    <article className={`libcard${wide ? " libcard--wide" : ""}`} data-testid="released-card">
      <Link className="libcard__cover" href={`/b/${book.slug}`} aria-label={`${book.title} · book page`}>
        <BookCover compact title={book.title} question={book.question} people={book.voices} countries={book.countries} names={[book.title]} />
      </Link>
      <div className="libcard__body">
        <span className="libcard__kick">
          Released{" "}
          {book.releasedIso ? <time dateTime={book.releasedIso}>{book.releasedLabel}</time> : book.releasedLabel}
        </span>
        <Link className="libcard__t" href={`/b/${book.slug}`}>
          {book.title}
        </Link>
        <span className="libcard__q">{book.question}</span>
        <span className="libcard__meta">
          {plural(book.voices, "voice")}
          {book.countries ? ` · ${plural(book.countries, "country", "countries")}` : ""}
          {book.chapters ? ` · ${plural(book.chapters, "chapter")}` : ""}
        </span>
        <span className="libcard__acts">
          <Link className="btn btn--red btn--sm" href={`/b/${book.slug}/read`}>
            Read
          </Link>
          {book.audio ? (
            <Link className="btn btn--sm" href={`/b/${book.slug}#listen`}>
              Listen
            </Link>
          ) : null}
          {book.video ? (
            <Link className="btn btn--sm" href={`/b/${book.slug}#watch`}>
              Watch
            </Link>
          ) : null}
        </span>
      </div>
    </article>
  );
}

/** Home section: the newest released books and a link to the whole Library. */
export function ReleasedShelf({ books, total }: { books: ShelfReleased[]; total: number }) {
  if (books.length === 0) return null;
  return (
    <section className="wrap section shelf rv in" aria-labelledby="released-books" data-testid="released-shelf">
      <div className="shelf__head">
        <h2 id="released-books">Released books</h2>
        <p>Every past book stays here to read, listen and watch.</p>
        <Link className="shelf__all" href="/library">
          {total > books.length ? `All ${total} in the Library` : "Open the Library"} →
        </Link>
      </div>
      <div className="libgrid">
        {books.map((book) => (
          <ReleasedCard key={book.id} book={book} />
        ))}
      </div>
    </section>
  );
}

/** Audiobook and film players on a released book's page, with downloads. */
export function BookMedia({ slug, audio, video, title }: { slug: string; audio: boolean; video: boolean; title: string }) {
  if (!audio && !video) return null;
  return (
    <section className="wrap section bmedia rv in" data-testid="book-media">
      <div className="section__head">
        <h2>Listen &amp; watch</h2>
      </div>
      <div className="bmedia__grid">
        {audio ? (
          <div className="bmedia__item" id="listen">
            <span className="label">Audiobook</span>
            <audio controls preload="none" src={`/api/media/${slug}/audiobook`} aria-label={`${title} audiobook`} />
            <a className="link" href={`/api/media/${slug}/audiobook?download=1`}>
              Download audio
            </a>
          </div>
        ) : null}
        {video ? (
          <div className="bmedia__item" id="watch">
            <span className="label">Film</span>
            <video controls preload="none" playsInline src={`/api/media/${slug}/video`} aria-label={`${title} film`} />
            <a className="link" href={`/api/media/${slug}/video?download=1`}>
              Download video
            </a>
          </div>
        ) : null}
      </div>
    </section>
  );
}
