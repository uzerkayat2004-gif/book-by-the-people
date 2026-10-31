"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { IconArrow, IconBack, IconList } from "@/components/icons";
import { AudioPlayer, DownloadButton } from "@/components/media-player";
import { QuotePlayer } from "@/components/quote-player";
import { chapterSummary } from "@/lib/book/summary";
import { countryByCode } from "@/lib/countries";
import { EN, fill, languageName, type Ui } from "@/lib/i18n";
import { LangSwitch } from "@/components/lang-switch";
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
  media = { audio: true, video: true },
  ui = EN,
  languages = [],
  lang = "",
}: {
  ui?: Ui;
  /** Languages this released book can be read in (empty: only one). */
  languages?: string[];
  /** The edition being read ("" = the book's own language). */
  lang?: string;
  slug: string;
  book: BookDocument;
  chapter: number;
  /** Which finished files this book has. Buttons show only for files that exist. */
  media?: { audio: boolean; video: boolean };
}) {
  const index = Math.min(book.chapters.length, Math.max(1, chapter)) - 1;
  const current = book.chapters[index];
  const next = book.chapters[index + 1];
  const bookTitle = book.title || book.question;
  const bookLang = book.language || "en";
  const q = lang ? `&lang=${lang}` : "";
  const [size, setSize] = useState(1);
  const [player, setPlayer] = useState<null | "audio" | "video">(null);
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
      <main className="page read3 read8" lang={bookLang} dir={["ar", "he", "fa", "ur"].includes(bookLang) ? "rtl" : "ltr"}>
        <article className="read3__col">
          <div className="read3__bar">
            <Link href={`/b/${slug}${lang ? `?lang=${lang}` : ""}`} className="read3__lnk">
              <IconBack size={16} /> {ui.cover}
            </Link>
            <span className="read3__tools">
              <LangSwitch languages={languages} current={bookLang} label={ui.language} href={(code) => `/b/${slug}/read?c=${index + 1}${languages[0] === code ? "" : `&lang=${code}`}`} />
              <button
                className="read3__lnk aa"
                type="button"
                aria-label={`${ui.textSize}: ${SIZES[size][0]}`}
                onClick={() => setSize((value) => (value + 1) % 3)}
              >
                A<small>a</small>
              </button>
              <button className="read3__lnk" type="button" onClick={() => setSheet(true)}>
                <IconList /> {ui.chapters}
              </button>
            </span>
          </div>
          <header className="read3__head">
            <div className="read3__kicker">
              {fill(ui.chapter, { n: index + 1 })} <span>·</span> {fill(ui.minRead, { n: mins })}
            </div>
            <h1 className="read3__title">{current.title}</h1>
            {chapterSummary(current.title, current.theme, "") ? <p className="read3__promise">{chapterSummary(current.title, current.theme, "")}</p> : null}
          </header>
          {media.audio || media.video ? (
            <div className="read-media" data-testid="read-media">
              {media.audio ? (
                <button className={`btn btn--sm${player === "audio" ? " on" : ""}`} type="button" onClick={() => setPlayer(player === "audio" ? null : "audio")}>
                  {ui.listen}
                </button>
              ) : null}
              {media.video ? (
                <button className={`btn btn--sm${player === "video" ? " on" : ""}`} type="button" onClick={() => setPlayer(player === "video" ? null : "video")}>
                  {ui.watch}
                </button>
              ) : null}
              {media.audio ? <DownloadButton href={`/api/media/${slug}/audiobook?download=1`} label={ui.downloadAudio} /> : null}
              {media.video ? <DownloadButton href={`/api/media/${slug}/video?download=1`} label={ui.downloadVideo} /> : null}
              {player === "audio" ? (
                <div className="read-media__player-box">
                  <AudioPlayer compact autoPlay src={`/api/media/${slug}/audiobook`} title={bookTitle} question={bookTitle} people={0} countries={0} />
                </div>
              ) : null}
              {player === "video" ? (
                <video className="read-media__player read-media__video" controls autoPlay playsInline preload="metadata" src={`/api/media/${slug}/video`} aria-label="Film" />
              ) : null}
            </div>
          ) : null}
          <div className="read3__body" style={{ ["--rs" as string]: `${SIZES[size][1]}px` }}>
            {body.map((paragraph, paragraphIndex) => (
              <p className={paragraphIndex === 0 ? "first" : ""} key={paragraphIndex}>
                {paragraph}
              </p>
            ))}
            {quotes.map((quote) => {
              const translated = (quote.language || "en") !== bookLang && quote.originalText && quote.originalText !== quote.englishText;
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
                        {fill(ui.translatedFrom, { language: languageName(quote.language, bookLang) })}
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
            {quotes.length} {quotes.length === 1 ? ui.voiceWord : ui.voicesWord}
          </p>
          {next ? (
            <Link className="read3__next" href={`/b/${slug}/read?c=${index + 2}${q}`}>
              <small>
                {ui.next} · {fill(ui.chapter, { n: index + 2 })}
              </small>
              <b>{next.title}</b>
              <IconArrow />
            </Link>
          ) : (
            <Link className="read3__next" href={`/b/${slug}${lang ? `?lang=${lang}` : ""}`}>
              <small>{ui.theEnd}</small>
              <b>{ui.backToCover}</b>
              <IconArrow />
            </Link>
          )}
        </article>
      </main>
      {sheet ? (
        <div className="scrim open" onClick={() => setSheet(false)}>
          <div className="sheet" role="dialog" aria-label={ui.contents} onClick={(event) => event.stopPropagation()}>
            <div className="grab" />
            <div className="label red">{ui.contents}</div>
            <div className="chlist toc8" style={{ marginTop: 10 }}>
              {book.chapters.map((item, itemIndex) => (
                <Link
                  key={item.id}
                  className={`chrow${itemIndex === index ? " cur" : ""}`}
                  href={`/b/${slug}/read?c=${itemIndex + 1}${q}`}
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
              {ui.close}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
