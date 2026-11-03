import type { AudioTrack } from "@/components/media-player";
import Link from "next/link";
import { BookCover } from "@/components/book-cover";
import { Countdown } from "@/components/countdown";
import { CountryPanel, type CountryRow } from "@/components/country-panel";
import { GlobeView } from "@/components/globe-view";
import { IconBook, IconPen, IconPlus, IconShare, IconShield } from "@/components/icons";
import { NamesMarquee } from "@/components/names-marquee";
import { PeopleList, type Person } from "@/components/people-list";
import { PollCard } from "@/components/poll-card";
import { HowSteps } from "@/components/how-steps";
import { ReadActions } from "@/components/read-actions";
import { BookMedia, OpenNow, type ShelfOpen } from "@/components/shelf";
import { ShareLink } from "@/components/share-link";
import { countryByCode } from "@/lib/countries";
import type { Stage } from "@/lib/stage";
import { EN, fill, type Ui } from "@/lib/i18n";

export type HomePin = { name: string; place?: string; lat: number; lng: number };
export type HomeName = { name: string; countryCode: string | null; region?: string };
export type HomeChapter = { title: string; summary: string; quote: { text: string; name: string } | null; voices: number; href: string };
export type HomePoll = { id: string; label: string; votes: number };
export type HomeClip = { src: string; startMs: number; endMs: number; name: string; text: string };

// "Add your voice" links are plain <a>: a full page load gives the voice page its own headers
// (cross-origin isolation), which makes speech to text about three times faster.
export function BookHome({
  stage,
  question,
  voiceCount,
  countries,
  pins,
  people = [],
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
  ui = EN,
  lang,
  languages,
}: {
  /** Page words in the book's language. */
  ui?: Ui;
  /** HTML lang/dir for the book's language. */
  lang?: { lang: string; dir: "ltr" | "rtl" };
  /** Released translations: shown as a language switch. */
  languages?: React.ReactNode;
  title?: string;
  slug?: string;
  media?: { audio: boolean; video: boolean; audioBytes?: number; videoBytes?: number; tracks?: AudioTrack[]; credit?: string; film?: { sub: string; credit: string } | null };
  stage: Stage;
  question: string;
  voiceCount: number;
  countries: CountryRow[];
  pins: HomePin[];
  /** Open books: who has spoken (name and place only). */
  people?: Person[];
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
  const place = latest?.countryCode ? (countryByCode(latest.countryCode)?.name ?? ui.theWorld) : ui.theWorld;
  const ticker = sealed
    ? voiceCount
      ? ui.sealedTicker
      : ui.firstVoice
    : latest
      ? fill(ui.justSpoke, { name: latest.name, place })
      : ui.firstVoice;
  return (
    <main className={stage === "after" ? "page bookflow" : "page home4 bookflow"} {...lang}>
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
          ui={ui}
          languages={languages}
        />
      ) : (
        <Before
          title={title}
          question={question}
          voiceCount={voiceCount}
          countries={countries}
          pins={pins}
          people={people}
          closesAt={closesAt}
          releaseLabel={releaseLabel}
          paused={paused}
          voiceHref={voiceHref}
          closed={stage === "closed"}
          ticker={ticker}
          sealed={sealed}
          owner={owner}
          ui={ui}
        />
      )}
      {stage === "after" || sealed ? null : <NamesMarquee names={names} />}
      {stage === "after" ? null : <How releaseLabel={releaseLabel} ui={ui} />}
      {stage === "after" && slug && media ? (
        <BookMedia slug={slug} media={media} title={title ?? question} question={question} people={voiceCount} countries={countries.length} flags={[...countries].sort((a, b) => b.count - a.count).map((c) => c.code.toLowerCase())} />
      ) : null}
      {mode === "home" ? <OpenNow books={openNow} heading="More books being written" /> : null}
      {bookId && poll.length ? <PollCard bookId={bookId} question={pollQuestion} options={poll} yourVote={yourVote} /> : null}
      <section className="wrap endzone" data-testid="book-foot">
        {stage === "after" ? null : (
          <div className="endband">
            <div className="endband__text">
              <span className="label red">{paused ? ui.paused : stage === "closed" ? ui.closed : ui.openNow}</span>
              <h2>{ui.belongs}</h2>
              <p>{ui.belongsSub}</p>
            </div>
            {voiceHref && !paused && stage !== "closed" ? (
              <a className="btn btn--red btn--big cta4 endband__btn" href={voiceHref}>
                <span className="rec" />
                {ui.addYourVoice}
              </a>
            ) : (
              <span className="btn btn--red btn--big cta4 endband__btn is-closed" aria-disabled="true">
                <span className="rec" />
                {paused ? ui.pausedNow : ui.closedNow}
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
              <span className="label">{ui.share}</span>
              <b className="endcard__t">{ui.invite}</b>
              <p>{ui.inviteSub}</p>
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
            <span className="label">{ui.explore}</span>
            <b className="endcard__t">{ui.moreBooks}</b>
            <p>{ui.moreBooksSub}</p>
            <div className="endcard__act">
              <Link className="btn btn--light btn--sm bookfoot__more" href="/books">
                {ui.seeOther} <span aria-hidden>→</span>
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
  people,
  closesAt,
  releaseLabel,
  paused,
  voiceHref,
  closed,
  ticker,
  sealed,
  owner,
  ui,
}: {
  ui: Ui;
  sealed?: boolean;
  owner?: string;
  title?: string;
  question: string;
  voiceCount: number;
  countries: CountryRow[];
  pins: HomePin[];
  people: Person[];
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
          <b>{voiceCount.toLocaleString("en-US")}</b> {ui.voicesSoFar}
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
            <span>{ui.theQuestion}</span>
            {owner ? <em className="topic__by">{fill(ui.by, { name: owner })}</em> : null}
          </div>
          <p className="topic__q">{question}</p>
        </div>
        <div className="cta6 in3">
          <Countdown closesAt={closesAt} frozen={closed} />
          {closed ? (
            <div className="cta6__open">
              {ui.voicesClosed} <b>{ui.beingWritten}</b>
            </div>
          ) : (
            <div className="cta6__open">
              {ui.closes} <b>{releaseLabel}</b>
            </div>
          )}
          {paused ? (
            <span className="btn btn--red btn--big btn--block cta4 is-closed" aria-disabled="true">
              <span className="rec" />
              {ui.pausedNow}
            </span>
          ) : closed || !voiceHref ? (
            <span className="btn btn--red btn--big btn--block cta4 is-closed" aria-disabled="true">
              <span className="rec" />
              {ui.closedNow}
            </span>
          ) : (
            <a className="btn btn--red btn--big btn--block cta4" href={voiceHref}>
              <span className="rec" />
              {ui.addYourVoice}
              <span className="cta4__t">{ui.fiveMin}</span>
            </a>
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
                <b>{voiceCount.toLocaleString("en-US")}</b>
                {voiceCount === 1 ? ui.voiceWord : ui.voicesWord}
              </span>
            </div>
            <PeopleList people={people} showAll={ui.showAll} showLess={ui.showLess} />
            <p className="gpanel__seal">
              <IconShield /> {ui.sealedNote}
            </p>
            {people.length ? <p className="gpanel__hint">{ui.tapDot}</p> : null}
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
  ui,
  languages,
}: {
  ui: Ui;
  languages?: React.ReactNode;
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
            {ui.outNow} · {date}
            {owner ? <span className="bookhero4__by"> · {fill(ui.by, { name: owner })}</span> : null}
          </div>
          <h2 className="bookhero4__h in2">{ui.bookHere}</h2>
          {languages}
          <ReadActions
            href={readHref}
            question={question}
            chapters={chapters.length}
            readMins={readMins}
            listenMins={listenMins}
            clips={clips}
            labels={{ read: ui.read, listen: ui.listen, watch: ui.watch, chapter: ui.chapterWord, chapters: ui.chaptersWord }}
          />
          <div className="bstats in5">
            <span>
              <b>{voiceCount.toLocaleString("en-US")}</b>
              {ui.people}
            </span>
            {countries > 0 ? (
              <span>
                <b>{countries}</b>
                {ui.countries}
              </span>
            ) : null}
            <span>
              <b>{chapters.length}</b>
              {ui.chaptersWord}
            </span>
          </div>
        </div>
      </section>
      <section className="wrap section rv in">
        <div className="shead5">
          <h2>{ui.chapters}</h2>
          <span className="label">
            {chapters.length} {chapters.length === 1 ? ui.chapterWord : ui.chaptersWord} · {fill(ui.minRead, { n: readMins })}
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
                  <span>{chapter.voices ? `${chapter.voices} ${chapter.voices === 1 ? ui.voiceWord : ui.voicesWord}` : ui.read}</span>
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

function How({ releaseLabel, ui }: { releaseLabel: string; ui: Ui }) {
  const day = releaseLabel.split(" · ")[0] || ui.soon;
  return (
    <HowSteps
      steps={[
        { icon: <IconPen />, title: ui.howSpeak, copy: ui.howSpeakCopy },
        { icon: <IconShield />, title: ui.howCheck, copy: ui.howCheckCopy },
        { icon: <IconBook />, title: ui.howDrop, copy: fill(ui.howDropCopy, { day }) },
      ]}
    />
  );
}
