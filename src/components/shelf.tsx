import Link from "next/link";
import { BookCover } from "@/components/book-cover";
import { AudioPlayer, FilmCard, type AudioTrack } from "@/components/media-player";

export type ShelfOpen = {
  id: string;
  slug: string;
  title: string;
  question: string;
  type: string;
  closesLabel: string | null;
  voices: number;
  countries: number;
  owner?: string;
  language?: string;
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

/** Grid that stays balanced: one book gets a wide card, two share the row, three or more flow in threes. */
function gridClass(base: string, count: number) {
  // Four reads better as two rows of two than as three plus one stranded card.
  return `${base} ${base}--${count === 1 ? "one" : count === 2 || count === 4 ? "two" : "many"}`;
}

function ShelfHead({ id, title, link }: { id: string; title: string; link?: { href: string; label: string } }) {
  return (
    <div className="shead5">
      <h2 id={id}>{title}</h2>
      {link ? (
        <Link className="shelf__all" href={link.href}>
          {link.label} <span aria-hidden>→</span>
        </Link>
      ) : null}
    </div>
  );
}

/** "Also open now": other books taking voices. Each has its own add-voice page. */
export function OpenNow({ books, heading = "Also open now", allLink = true }: { books: ShelfOpen[]; heading?: string; allLink?: boolean }) {
  if (books.length === 0) return null;
  return (
    <section className="wrap section shelf rv in" aria-labelledby="open-now" data-testid="open-now">
      <ShelfHead id="open-now" title={heading} link={allLink ? { href: "/books", label: "All books" } : undefined} />
      <div className={gridClass("opengrid", books.length)}>
        {books.map((book) => (
          <article className="opencard" key={book.id} data-testid="open-card">
            <Link className="opencard__top" href={`/b/${book.slug}`}>
              <span className="opencard__live">
                <i aria-hidden />
                {book.type === "FAMOUS" ? "Collecting quotes" : "Taking voices"}
                {book.closesLabel ? <span className="opencard__close"> · closes {book.closesLabel}</span> : null}
              </span>
              <b className="opencard__t">{book.title}</b>
              <span className="opencard__q">{book.question}</span>
              {book.owner ? <span className="opencard__by">by {book.owner}</span> : null}
            </Link>
            <div className="opencard__foot">
              <span className="opencard__count">
                <b>{book.voices.toLocaleString("en-US")}</b> {book.voices === 1 ? "voice" : "voices"}
                {book.countries ? (
                  <>
                    {" · "}
                    <b>{book.countries}</b> {book.countries === 1 ? "country" : "countries"}
                  </>
                ) : null}
              </span>
              {book.type === "OPEN" ? (
                <a className="btn btn--red btn--sm opencard__cta" href={`/b/${book.slug}/voice`}>
                  <span className="rec" />
                  Add your voice
                </a>
              ) : (
                <Link className="btn btn--sm btn--ghost opencard__cta" href={`/b/${book.slug}`}>
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
  const actions = 1 + (book.audio ? 1 : 0) + (book.video ? 1 : 0);
  return (
    <article className={`libcard${wide ? " libcard--wide" : ""}`} data-testid="released-card">
      <div className="libcard__main">
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
        </div>
      </div>
      <span className="libcard__acts" style={{ ["--n" as string]: actions }}>
        <Link className="btn btn--red btn--sm" href={`/b/${book.slug}/read`}>
          Read
        </Link>
        {book.audio ? (
          <Link className="btn btn--sm btn--ghost" href={`/b/${book.slug}#listen`}>
            Listen
          </Link>
        ) : null}
        {book.video ? (
          <Link className="btn btn--sm btn--ghost" href={`/b/${book.slug}#watch`}>
            Watch
          </Link>
        ) : null}
      </span>
    </article>
  );
}

/** A grid of released books, balanced for one, two or many. */
export function ReleasedGrid({ books, wide = false, testId }: { books: ShelfReleased[]; wide?: boolean; testId?: string }) {
  return (
    <div className={gridClass("libgrid", books.length)} data-testid={testId}>
      {books.map((book) => (
        <ReleasedCard key={book.id} book={book} wide={wide} />
      ))}
    </div>
  );
}

/** Home section: the newest released books and a link to the whole Library. */
export function ReleasedShelf({ books, total }: { books: ShelfReleased[]; total: number }) {
  if (books.length === 0) return null;
  return (
    <section className="wrap section shelf rv in" aria-labelledby="released-books" data-testid="released-shelf">
      <ShelfHead
        id="released-books"
        title="Released books"
        link={{ href: "/library", label: total > books.length ? `All ${total} in the Library` : "Open the Library" }}
      />
      <ReleasedGrid books={books} />
    </section>
  );
}

/** Audiobook and film on a released book's page, with downloads. */
export function BookMedia({
  slug,
  media,
  title,
  question,
  people,
  countries,
}: {
  slug: string;
  media: { audio: boolean; video: boolean; audioBytes?: number; videoBytes?: number; tracks?: AudioTrack[]; credit?: string };
  title: string;
  question: string;
  people: number;
  countries: number;
}) {
  if (!media.audio && !media.video) return null;
  // The size changes whenever the files are made again, so it doubles as a cache key.
  const audioSrc = `/api/media/${slug}/audiobook?v=${media.audioBytes ?? 0}`;
  const videoSrc = `/api/media/${slug}/video?v=${media.videoBytes ?? 0}`;
  const both = media.audio && media.video;
  return (
    <section className="wrap section bmedia rv in" data-testid="book-media">
      <div className="shead5">
        <h2>Listen &amp; watch</h2>
        <span className="label">Free · no sign-in</span>
      </div>
      <div className={`bmedia__grid${both ? "" : " bmedia__grid--one"}`}>
        {media.audio ? (
          <div className="bmedia__item bmedia__item--audio" id="listen">
            <AudioPlayer
              src={audioSrc}
              title={title}
              question={question}
              people={people}
              countries={countries}
              bytes={media.audioBytes}
              downloadHref={`/api/media/${slug}/audiobook?download=1`}
              tracks={media.tracks?.length ? media.tracks : undefined}
              credit={media.credit || undefined}
            />
          </div>
        ) : null}
        {media.video ? (
          <div className="bmedia__item bmedia__item--film" id="watch">
            <FilmCard src={videoSrc} title={title} question={question} people={people} bytes={media.videoBytes} downloadHref={`/api/media/${slug}/video?download=1`} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
