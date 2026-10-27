import Link from "next/link";
import { BookCover } from "@/components/book-cover";
import { Countdown } from "@/components/countdown";
import { CountryPanel, type CountryRow } from "@/components/country-panel";
import { GlobeView } from "@/components/globe-view";
import { IconBook, IconMic, IconShield } from "@/components/icons";
import { NamesMarquee } from "@/components/names-marquee";
import { PollCard } from "@/components/poll-card";
import { ReadActions } from "@/components/read-actions";
import { countryByCode } from "@/lib/countries";
import type { Stage } from "@/lib/stage";

export type HomePin = { name: string; lat: number; lng: number };
export type HomeName = { name: string; countryCode: string | null; region?: string };
export type HomeChapter = { title: string; promise: string; href: string };
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
}: {
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
  others?: { href: string; title: string; meta: string }[];
}) {
  const latest = names[names.length - 1];
  const place = latest?.countryCode ? (countryByCode(latest.countryCode)?.name ?? "the world") : "the world";
  const ticker = latest ? `${latest.name} from ${place} just spoke` : "Be the first voice";
  return (
    <main className={stage === "after" ? "page" : "page home4"}>
      {stage === "after" ? (
        <After
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
      {bookId && poll.length ? <PollCard bookId={bookId} question={pollQuestion} options={poll} yourVote={yourVote} /> : null}
      <p className="ownbook wrap">
        <Link href="/books/new">Start your own book</Link>
        {" · "}
        <Link href="/explore">Explore</Link>
      </p>
      {stage === "after" ? null : (
        <section className="wrap section rv in">
          <div className="cta-band">
            <h2>Your voice belongs in this book.</h2>
            {voiceHref && !paused ? (
              <Link className="btn btn--red btn--big" href={voiceHref}>
                <span className="rec" />
                Add your voice
              </Link>
            ) : (
              <span className="btn btn--red btn--big">
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

function Before({
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
  return (
    <section className="wrap hero4">
      <div className="hero4__text">
        <div className="eyebrow in1">
          <span className="live">
            <i />
          </span>
          <span>
            <b>{voiceCount.toLocaleString("en-US")}</b> voices so far
          </span>
        </div>
        <h1 className="hero4__title">
          <span className="w">
            <span style={{ ["--d" as string]: "80ms" }}>Book by</span>
          </span>{" "}
          <span className="w red">
            <span style={{ ["--d" as string]: "160ms" }}>the people.</span>
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
            <span className="btn btn--red btn--big btn--block cta4">
              <span className="rec" />
              Voices are paused right now
            </span>
          ) : closed || !voiceHref ? (
            <span className="btn btn--red btn--big btn--block cta4 is-closed">
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
}) {
  const date = releaseLabel.split(" · ")[0];
  return (
    <>
      <section className="wrap bookhero4">
        <div className="bookhero4__art in1">
          <BookCover question={question} people={voiceCount} countries={countries} names={names} />
        </div>
        <div className="bookhero4__side">
          <div className="label red in1">Out now · {date}</div>
          <h2 className="bookhero4__h in2">The book is here.</h2>
          <ReadActions href={readHref} question={question} chapters={chapters.length} readMins={readMins} listenMins={listenMins} clips={clips} />
          <div className="bstats in5">
            <span>
              <b>{voiceCount.toLocaleString("en-US")}</b>people
            </span>
            <span>
              <b>{countries}</b>countries
            </span>
            <span>
              <b>{chapters.length}</b>chapters
            </span>
          </div>
        </div>
      </section>
      <section className="wrap section rv in">
        <div className="section__head">
          <h2>Chapters</h2>
        </div>
        <div className="chlist4">
          {chapters.map((chapter, index) => (
            <Link className="ch4 rv in" key={chapter.href} href={chapter.href}>
              <span className="ch4__n">{String(index + 1).padStart(2, "0")}</span>
              <span className="ch4__t">
                <b>{chapter.title}</b>
                <small>{chapter.promise}</small>
              </span>
            </Link>
          ))}
        </div>
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
        <span className="how5__line" aria-hidden="true">
          <i />
          <em />
        </span>
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
