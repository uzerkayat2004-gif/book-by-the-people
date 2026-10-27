"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { IconArrow, IconBack, IconList } from "@/components/icons";
import { QuotePlayer } from "@/components/quote-player";
import { countryByCode } from "@/lib/countries";
import { languageByCode } from "@/lib/languages";
import { stripPeopleCounts } from "@/lib/book/checks";
import type { BookDocument } from "@/lib/book/types";

const SIZES = [
  ["Small", 18],
  ["Medium", 20],
  ["Large", 22],
] as const;

export function Reader({
  slug,
  book,
  chapter,
}: {
  slug: string;
  book: BookDocument;
  chapter: number;
}) {
  const index = Math.min(book.chapters.length, Math.max(1, chapter)) - 1;
  const current = book.chapters[index];
  const next = book.chapters[index + 1];
  const [size, setSize] = useState(1);
  const [sheet, setSheet] = useState(false);
  const [openOriginal, setOpenOriginal] = useState<string | null>(null);
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>("[data-read-progress]");
    if (!bar) return;
    const onScroll = () => {
      const height = document.documentElement.scrollHeight - window.innerHeight;
      const progress = height > 0 ? window.scrollY / height : 0;
      bar.style.transform = `scaleX(${progress})`;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [index]);

  if (!current) return null;
  const quotes = current.quotes.filter((quote) => !quote.hidden);
  const words = `${current.narrative} ${quotes.map((quote) => quote.englishText).join(" ")}`.split(/\s+/).filter(Boolean).length;
  const mins = Math.max(1, Math.ceil(words / 200));
  const quoteText = quotes.map((quote) => stripPeopleCounts(quote.englishText)).filter(Boolean);
  const narrative = stripPeopleCounts(current.narrative);
  const body = narrative
    .split(/\n\n+/)
    .map((paragraph) => stripPeopleCounts(paragraph))
    .filter((paragraph) => paragraph && !quoteText.some((text) => paragraph.includes(text.slice(0, 24)) || text.includes(paragraph.slice(0, 24))));

  return (
    <>
      <div className="rprog" aria-hidden="true">
        <i data-read-progress />
      </div>
      <main className="page read3 read8">
        <article className="read3__col">
          <div className="read3__bar">
            <Link href={`/b/${slug}`} className="read3__lnk">
              <IconBack size={16} /> Cover
            </Link>
            <span className="read3__tools">
              <button
                className="read3__lnk aa"
                type="button"
                aria-label={`Text size: ${SIZES[size][0]}`}
                onClick={() => setSize((value) => (value + 1) % 3)}
              >
                A<small>a</small>
              </button>
              <button className="read3__lnk" type="button" onClick={() => setSheet(true)}>
                <IconList /> Chapters
              </button>
            </span>
          </div>
          <header className="read3__head">
            <div className="read3__kicker">
              Chapter {index + 1} <span>·</span> {mins} min read
            </div>
            <h1 className="read3__title">{current.title}</h1>
            <p className="read3__promise">{current.theme}</p>
          </header>
          <div className="read-media">
            <a className="btn btn--sm" href={`/api/media/${slug}/audiobook`}>
              Listen
            </a>
            <a className="btn btn--sm" href={`/api/media/${slug}/video`}>
              Watch
            </a>
            <a className="link" href={`/api/media/${slug}/audiobook?download=1`}>
              Download audio
            </a>
            <a className="link" href={`/api/media/${slug}/video?download=1`}>
              Download video
            </a>
          </div>
          <div className="read3__body" style={{ ["--rs" as string]: `${SIZES[size][1]}px` }}>
            {body.map((paragraph, paragraphIndex) => (
              <p className={paragraphIndex === 0 ? "first" : ""} key={paragraphIndex}>
                {paragraph}
              </p>
            ))}
            {quotes.map((quote) => {
              const translated = quote.language !== "en" && quote.originalText && quote.originalText !== quote.englishText;
              const country = countryByCode(quote.countryCode)?.name;
              const prose = stripPeopleCounts(quote.englishText);
              return (
                <blockquote className="pq prose" key={quote.id}>
                  <p data-testid="quote-text">{prose}</p>
                  <cite>
                    {quote.kind === "sourced_quote" ? quote.speakerName : null}
                    {quote.kind === "sourced_quote" && country ? <span> · {country}</span> : null}
                    {quote.hasAudio && quote.kind !== "sourced_quote" ? (
                      <QuotePlayer src={`/api/audio/${quote.voiceId}`} startMs={quote.startMs} endMs={quote.endMs} />
                    ) : null}
                    {quote.kind === "sourced_quote" && quote.sourceUrl ? (
                      <a href={quote.sourceUrl} target="_blank" rel="noreferrer">
                        Source
                      </a>
                    ) : null}
                    {quote.sourceDate ? <span> · {quote.sourceDate}</span> : null}
                    {translated ? (
                      <button
                        className="trtag"
                        type="button"
                        aria-expanded={openOriginal === quote.id}
                        onClick={() => setOpenOriginal((value) => (value === quote.id ? null : quote.id))}
                      >
                        Translated from {languageByCode(quote.language).name}
                      </button>
                    ) : null}
                  </cite>
                  {translated ? (
                    <p className="orig" hidden={openOriginal !== quote.id} lang={quote.language} dir={["ar", "he", "fa", "ur"].includes(quote.language) ? "rtl" : "ltr"}>
                      {quote.originalText}
                    </p>
                  ) : null}
                </blockquote>
              );
            })}
          </div>
          <div className="orn8" aria-hidden="true">
            · · ·
          </div>
          <p className="count8">
            {quotes.length} {quotes.length === 1 ? "voice" : "voices"}
          </p>
          {next ? (
            <Link className="read3__next" href={`/b/${slug}/read?c=${index + 2}`}>
              <small>Next · Chapter {index + 2}</small>
              <b>{next.title}</b>
              <IconArrow />
            </Link>
          ) : (
            <Link className="read3__next" href={`/b/${slug}`}>
              <small>The end</small>
              <b>Back to the cover</b>
              <IconArrow />
            </Link>
          )}
        </article>
      </main>
      {sheet ? (
        <div className="scrim open" onClick={() => setSheet(false)}>
          <div className="sheet" role="dialog" aria-label="Contents" onClick={(event) => event.stopPropagation()}>
            <div className="grab" />
            <div className="label red">Contents</div>
            <div className="chlist toc8" style={{ marginTop: 10 }}>
              {book.chapters.map((item, itemIndex) => (
                <Link
                  key={item.id}
                  className={`chrow${itemIndex === index ? " cur" : ""}`}
                  href={`/b/${slug}/read?c=${itemIndex + 1}`}
                  aria-current={itemIndex === index ? "page" : undefined}
                  onClick={() => setSheet(false)}
                >
                  <span className="chrow__n">{String(itemIndex + 1).padStart(2, "0")}</span>
                  <span className="chrow__t">
                    {item.title}
                    <small>{item.theme}</small>
                  </span>
                  <IconArrow />
                </Link>
              ))}
            </div>
            <button className="btn btn--ghost btn--block" type="button" onClick={() => setSheet(false)} style={{ marginTop: 16 }}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
