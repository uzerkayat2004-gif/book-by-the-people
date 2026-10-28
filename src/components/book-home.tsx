import Link from "next/link";
import { BookCover } from "@/components/book-cover";
import { Countdown } from "@/components/countdown";
import { CountryPanel, type CountryRow } from "@/components/country-panel";
import { GlobeView } from "@/components/globe-view";
import { IconBook, IconMic, IconShield } from "@/components/icons";
import { NamesMarquee } from "@/components/names-marquee";
import { PollCard } from "@/components/poll-card";
import { ReadActions } from "@/components/read-actions";
import { BookMedia, OpenNow, ReleasedShelf, type ShelfOpen, type ShelfReleased } from "@/components/shelf";
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
  released = [],
  releasedTotal = 0,
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
  /** Other books taking voices right now (home page). */
  openNow?: ShelfOpen[];
  /** Released books (home page), newest first, and how many there are in all. */
  released?: ShelfReleased[];
  releasedTotal?: number;
}) {
  const latest = names[names.length - 1];
  const place = latest?.countryCode ? (countryByCode(latest.countryCode)?.name ?? "the world") : "the world";
  const ticker = latest ? `${latest.name} from ${place} just spoke` : "Be the first voice";
  return (
    <main className={stage === "after" ? "page" : "page home4"}>
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
        />
      )}
      {stage === "after" ? null : <NamesMarquee names={names} />}
      {stage === "after" ? null : <How releaseLabel={releaseLabel} />}
      {stage === "after" && slug && media ? (
        <BookMedia slug={slug} media={media} title={title ?? question} question={question} people={voiceCount} countries={countries.length} />
      ) : null}
      <OpenNow books={openNow} heading={stage === "after" ? "Open now · add your voice" : "Also open now"} />
      <ReleasedShelf books={released} total={releasedTotal} />
      {bookId && poll.length ? <PollCard bookId={bookId} question={pollQuestion} options={poll} yourVote={yourVote} /> : null}
      <p className="ownbook wrap">
        <Link href="/books/new">Start your own book</Link>
        {" · "}
        <Link href="/library">Library</Link>
        {" · "}
        <Link href="/explore">Explore</Link>
      </p>
      {stage === "after" ? null : (
        <section className="wrap section rv in">
          <div className="cta-band">
            <h2>Your voice belongs in this book.</h2>
            {voiceHref && !paused ? (
              <Link className="btn btn--red btn--big cta4" href={voiceHref}>
                <span className="rec" />
                Add your voice
              </Link>
            ) : (
              <span className="btn btn--red btn--big cta4 is-closed" aria-disabled="true">
                <span className="rec" />
                {paused ? "Voices are paused right now" : "Voices are closed"}
              </span>
            )}
          </div>
        </section>
      )}
    </main>
  );
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
}: {
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
        <h1 className="hero4__title">
          <span className="w">
            <span style={{ ["--d" as string]: "80ms" }}>{lineA}</span>
          </span>{" "}
          <span className="w red">
            <span style={{ ["--d" as string]: "160ms" }}>{lineB}</span>
          </span>
        </h1>
        <div className="topic in2">
          <div className="topic__label">
            <span>Book 1</span> The question
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
              Opens <b>{releaseLabel}</b>
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
        <CountryPanel countries={countries} voiceCount={voiceCount} />
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
}: {
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
          <div className="label red in1">Out now · {date}</div>
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
  const steps = [
    [IconMic, "Speak", "Up to 10 minutes. No typing."],
    [IconShield, "AI checks", "AI groups similar views together."],
    [IconBook, "Book drops", `${releaseLabel.split(" · ")[0] || "Oct 26"}. Read, listen, watch.`],
  ] as const;
  return (
    <section className="wrap section how5 rv in" id="how">
      <h2 className="how5__h">
        Your voice.
        <br />
        <span className="red">A real book.</span>
      </h2>
      <ol className="how5__steps">
        {steps.map(([Icon, title, copy], index) => (
          <li className="how5__s" style={{ ["--i" as string]: index }} key={title}>
            <span className="how5__ic">
              <Icon />
            </span>
            <span className="how5__n">0{index + 1}</span>
            <b className="how5__t">{title}</b>
            <p>{copy}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
