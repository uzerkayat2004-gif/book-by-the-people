import Link from "next/link";
import { BookCover } from "@/components/book-cover";
import { Countdown } from "@/components/countdown";
import { CountryPanel, type CountryRow } from "@/components/country-panel";
import { GlobeView } from "@/components/globe-view";
import { IconBook, IconMic, IconPlus, IconShare, IconShield } from "@/components/icons";
import { NamesMarquee } from "@/components/names-marquee";
import { PollCard } from "@/components/poll-card";
import { HowSteps } from "@/components/how-steps";
import { ReadActions } from "@/components/read-actions";
import { BookMedia, OpenNow, type ShelfOpen } from "@/components/shelf";
import { ShareLink } from "@/components/share-link";
import { countryByCode } from "@/lib/countries";
import type { Stage } from "@/lib/stage";

export type HomePin = { name: string; lat: number; lng: number };
export type HomeName = { name: string; countryCode: string | null; region?: string };
export type HomeChapter = { title: string; summary: string; quote: { text: string; name: string } | null; voices: number; href: string };
export type HomePoll = { id: string; label: string; votes: number };
export type HomeClip = { src: string; startMs: number; endMs: number; name: string; text: string };

export function BookHome({
  stage,
  question,
  voiceCount,
  countries,
  pins,
  names,
  closesAt,
  releaseLabel,
  paused,
  voiceHref,
  readHref,
  chapters,
  readMins,
  listenMins,
  pollQuestion,
  poll,
  bookId,
  yourVote,
  clips,
  title,
  slug,
  media,
  openNow = [],
  sealed = false,
  owner,
  mode = "book",
}: {
  title?: string;
  slug?: string;
  media?: { audio: boolean; video: boolean; audioBytes?: number; videoBytes?: number };
  stage: Stage;
  question: string;
  voiceCount: number;
  countries: CountryRow[];
  pins: HomePin[];
  names: HomeName[];
  closesAt: string | null;
  releaseLabel: string;
  paused: boolean;
  voiceHref: string | null;
  readHref: string;
  chapters: HomeChapter[];
  readMins: number;
  listenMins: number;
  pollQuestion: string;
  poll: HomePoll[];
  bookId: string | null;
  yourVote: string | null;
  clips: HomeClip[];
  /** Home page only: a short strip of other books taking voices. */
  openNow?: ShelfOpen[];
  /** Before release the public page shows only counts: no names, no places. */
  sealed?: boolean;
  /** The owner's public name. */
  owner?: string;
  /** "book" is a book's own page (just this book); "home" adds the strip of other books. */
  mode?: "home" | "book";
}) {
  const latest = names[names.length - 1];
  const place = latest?.countryCode ? (countryByCode(latest.countryCode)?.name ?? "the world") : "the world";
  const ticker = sealed
    ? voiceCount
      ? "Every voice stays sealed until release"
      : "Be the first voice"
    : latest
      ? `${latest.name} from ${place} just spoke`
      : "Be the first voice";
  return (
    <main className={stage === "after" ? "page bookflow" : "page home4 bookflow"}>
      {stage === "after" ? (
        <After
          title={title}
          question={question}
          voiceCount={voiceCount}
          countries={countries.length}
          names={names.map((person) => person.name)}
          releaseLabel={releaseLabel}
          readHref={readHref}
          chapters={chapters}
          readMins={readMins}
          listenMins={listenMins}
          clips={clips}
          owner={owner}
        />
      ) : (
        <Before
          title={title}
          question={question}
          voiceCount={voiceCount}
          countries={countries}
          pins={pins}
          closesAt={closesAt}
          releaseLabel={releaseLabel}
          paused={paused}
          voiceHref={voiceHref}
          closed={stage === "closed"}
          ticker={ticker}
          sealed={sealed}
          owner={owner}
        />
      )}
      {stage === "after" || sealed ? null : <NamesMarquee names={names} />}
      {stage === "after" ? null : <How releaseLabel={releaseLabel} />}
      {stage === "after" && slug && media ? (
        <BookMedia slug={slug} media={media} title={title ?? question} question={question} people={voiceCount} countries={countries.length} />
      ) : null}
      {mode === "home" ? <OpenNow books={openNow} heading="More books being written" /> : null}
      {bookId && poll.length ? <PollCard bookId={bookId} question={pollQuestion} options={poll} yourVote={yourVote} open={stage === "after"} /> : null}
      <section className="wrap endzone" data-testid="book-foot">
        {stage === "after" ? null : (
          <div className="endband">
            <div className="endband__text">
              <span className="label red">{paused ? "Paused" : stage === "closed" ? "Closed" : "Open now"}</span>
              <h2>Your voice belongs in this book.</h2>
              <p>Speak or write for up to 10 minutes. Your words stay sealed until the book is released.</p>
            </div>
            {voiceHref && !paused && stage !== "closed" ? (
              <Link className="btn btn--red btn--big cta4 endband__btn" href={voiceHref}>
                <span className="rec" />
                Add your voice
              </Link>
            ) : (
              <span className="btn btn--red btn--big cta4 endband__btn is-closed" aria-disabled="true">
                <span className="rec" />
                {paused ? "Voices are paused right now" : "Voices are closed"}
              </span>
            )}
          </div>
        )}
        <div className="endpair">
          {mode === "book" && slug ? (
            <div className="endcard">
              <span className="endcard__ic" aria-hidden="true">
                <IconShare />
              </span>
              <span className="label">Share</span>
              <b className="endcard__t">Invite your people</b>
              <p>Every voice makes the book better. Send them the link.</p>
              <div className="endcard__act">
                <ShareLink path={`/b/${slug}`} title={title ?? question} />
              </div>
            </div>
          ) : (
            <div className="endcard">
              <span className="endcard__ic" aria-hidden="true">
                <IconPlus />
              </span>
              <span className="label">Your own book</span>
              <b className="endcard__t">Ask your own question</b>
              <p>Your community answers. AI writes the book. Free.</p>
              <div className="endcard__act">
                <Link className="btn btn--light btn--sm" href="/books/new">
                  Start your own book <span aria-hidden>→</span>
                </Link>
              </div>
            </div>
          )}
          <div className="endcard">
            <span className="endcard__ic" aria-hidden="true">
              <IconBook />
            </span>
            <span className="label">Explore</span>
            <b className="endcard__t">More books</b>
            <p>See what others are writing now, or read the released ones.</p>
            <div className="endcard__act">
              <Link className="btn btn--light btn--sm bookfoot__more" href="/books">
                See other books <span aria-hidden>→</span>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

/**
 * Sizes the big title for any length: the longest word always fits the column
 * (no mid-word breaks) and long titles shrink so they stay within about three lines.
 */
function titleFit(lineA: string, lineB: string): React.CSSProperties {
  const all = `${lineA} ${lineB}`.trim();
  const longest = Math.max(4, ...all.split(/\s+/).map((word) => word.length));
  const total = Math.max(8, all.length);
  return { ["--lw" as string]: longest, ["--tl" as string]: total };
}

function heroLines(title?: string): [string, string] {
  const clean = (title ?? "").trim().replace(/[.?!]+$/, "");
  if (!clean || clean.toLowerCase() === "book by the people") return ["Book by", "the people."];
  const words = clean.split(/\s+/);
  if (words.length === 1) return [clean, "."];
  let cut = 1;
  let best = Infinity;
  for (let index = 1; index < words.length; index += 1) {
    const delta = Math.abs(words.slice(0, index).join(" ").length - words.slice(index).join(" ").length);
    if (delta < best) {
      best = delta;
      cut = index;
    }
  }
  return [words.slice(0, cut).join(" "), `${words.slice(cut).join(" ")}.`];
}

function Before({
  title,
  question,
  voiceCount,
  countries,
  pins,
  closesAt,
  releaseLabel,
  paused,
  voiceHref,
  closed,
  ticker,
  sealed,
  owner,
}: {
  sealed?: boolean;
  owner?: string;
  title?: string;
  question: string;
  voiceCount: number;
  countries: CountryRow[];
  pins: HomePin[];
  closesAt: string | null;
  releaseLabel: string;
  paused: boolean;
  voiceHref: string | null;
  closed: boolean;
  ticker: string;
}) {
  const [lineA, lineB] = heroLines(title);
  return (
    <section className="wrap hero4">
      <div className="hero4__text">
        <span className="eyebrow in1">
          <span className="live">
            <i />
          </span>
          <b>{voiceCount.toLocaleString("en-US")}</b> voices so far
        </span>
        <h1 className="hero4__title" style={titleFit(lineA, lineB)} data-testid="hero-title">
          {lineB === "." ? (
            <span className="w">
              <span style={{ ["--d" as string]: "80ms" }}>
                {lineA}
                <em className="dot">.</em>
              </span>
            </span>
          ) : (
            <>
              <span className="w">
                <span style={{ ["--d" as string]: "80ms" }}>{lineA}</span>
              </span>{" "}
              <span className="w red">
                <span style={{ ["--d" as string]: "160ms" }}>{lineB}</span>
              </span>
            </>
          )}
        </h1>
        <div className="topic in2">
          <div className="topic__label">
            <span>The question</span>
            {owner ? <em className="topic__by">by {owner}</em> : null}
          </div>
          <p className="topic__q">{question}</p>
        </div>
        <div className="cta6 in3">
          <Countdown closesAt={closesAt} frozen={closed} />
          {closed ? (
            <div className="cta6__open">
              Voices closed. <b>The book is being written.</b>
            </div>
          ) : (
            <div className="cta6__open">
              Closes <b>{releaseLabel}</b>
            </div>
          )}
          {paused ? (
            <span className="btn btn--red btn--big btn--block cta4 is-closed" aria-disabled="true">
              <span className="rec" />
              Voices are paused right now
            </span>
          ) : closed || !voiceHref ? (
            <span className="btn btn--red btn--big btn--block cta4 is-closed" aria-disabled="true">
              <span className="rec" />
              Voices are closed
              <span className="cta4__t">10 min</span>
            </span>
          ) : (
            <Link className="btn btn--red btn--big btn--block cta4" href={voiceHref}>
              <span className="rec" />
              Add your voice
              <span className="cta4__t">10 min</span>
            </Link>
          )}
          <div className="cta6__live">
              <span className="live">
                <i />
              </span>
              <span className="ticker show">{ticker}</span>
            </div>
        </div>
      </div>
      <div className="hero4__globe in3">
        <div className="globebox" id="globe">
          <GlobeView pins={pins} />
        </div>
        {sealed ? (
          <div className="gpanel gpanel--sealed" data-testid="sealed-panel">
            <div className="gpanel__stats">
              <span>
                <b>{voiceCount.toLocaleString("en-US")}</b>voices
              </span>
            </div>
            <p className="gpanel__seal">
              <IconShield /> Names, places and words stay sealed until the book is released.
            </p>
          </div>
        ) : (
          <CountryPanel countries={countries} voiceCount={voiceCount} />
        )}
      </div>
    </section>
  );
}

function After({
  title,
  question,
  voiceCount,
  countries,
  names,
  releaseLabel,
  readHref,
  chapters,
  readMins,
  listenMins,
  clips,
  owner,
}: {
  owner?: string;
  question: string;
  voiceCount: number;
  countries: number;
  names: string[];
  releaseLabel: string;
  readHref: string;
  chapters: HomeChapter[];
  readMins: number;
  listenMins: number;
  clips: HomeClip[];
  title?: string;
}) {
  const date = releaseLabel.split(" · ")[0];
  return (
    <>
      <section className="wrap bookhero4">
        <div className="bookhero4__art in1">
          <BookCover title={title} question={question} people={voiceCount} countries={countries} names={names} />
        </div>
        <div className="bookhero4__side">
          <div className="label red in1">
            Out now · {date}
            {owner ? <span className="bookhero4__by"> · by {owner}</span> : null}
          </div>
          <h2 className="bookhero4__h in2">The book is here.</h2>
          <ReadActions href={readHref} question={question} chapters={chapters.length} readMins={readMins} listenMins={listenMins} clips={clips} />
          <div className="bstats in5">
            <span>
              <b>{voiceCount.toLocaleString("en-US")}</b>people
            </span>
            {countries > 0 ? (
              <span>
                <b>{countries}</b>countries
              </span>
            ) : null}
            <span>
              <b>{chapters.length}</b>chapters
            </span>
          </div>
        </div>
      </section>
      <section className="wrap section rv in">
        <div className="shead5">
          <h2>Chapters</h2>
          <span className="label">
            {chapters.length} {chapters.length === 1 ? "chapter" : "chapters"} · {readMins} min read
          </span>
        </div>
        <ol className="toc5" data-testid="chapter-list">
          {chapters.map((chapter, index) => (
            <li key={chapter.href}>
              <Link className="toc5__row" href={chapter.href}>
                <span className="toc5__n">{String(index + 1).padStart(2, "0")}</span>
                <span className="toc5__body">
                  <b className="toc5__t">{chapter.title}</b>
                  {chapter.summary ? <span className="toc5__s">{chapter.summary}</span> : null}
                  {chapter.quote ? (
                    <span className="toc5__q">
                      “{chapter.quote.text}”{chapter.quote.name ? <em> — {chapter.quote.name}</em> : null}
                    </span>
                  ) : null}
                </span>
                <span className="toc5__meta">
                  <span>{chapter.voices ? `${chapter.voices} ${chapter.voices === 1 ? "voice" : "voices"}` : "Read"}</span>
                  <span className="toc5__go" aria-hidden>
                    →
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function How({ releaseLabel }: { releaseLabel: string }) {
  const day = releaseLabel.split(" · ")[0] || "Soon";
  return (
    <HowSteps
      steps={[
        { icon: <IconMic />, title: "Speak or write", copy: "Talk or type, up to 10 minutes, in your own words." },
        { icon: <IconShield />, title: "AI checks", copy: "Real people, on topic. Same views, one paragraph." },
        { icon: <IconBook />, title: "Book drops", copy: `${day}. Read, listen, watch.` },
      ]}
    />
  );
}
