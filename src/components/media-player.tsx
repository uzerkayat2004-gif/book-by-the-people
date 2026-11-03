"use client";

import { useEffect, useRef, useState } from "react";
import { BookCover } from "@/components/book-cover";
import { IconBack15, IconDownload, IconFwd15, IconPause, IconPlay } from "@/components/icons";

const SPEEDS = [1, 1.25, 1.5, 2];

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** Reads a file's length without downloading it: a metadata-only load. */
export function useDuration(src: string | null): number | null {
  const [duration, setDuration] = useState<number | null>(null);
  useEffect(() => {
    if (!src) return;
    const probe = new Audio();
    probe.preload = "metadata";
    const done = () => {
      if (Number.isFinite(probe.duration)) setDuration(probe.duration);
    };
    probe.addEventListener("loadedmetadata", done);
    probe.src = src;
    return () => {
      probe.removeEventListener("loadedmetadata", done);
      probe.removeAttribute("src");
      probe.load();
    };
  }, [src]);
  return duration;
}

export function DownloadButton({ href, label, bytes }: { href: string; label: string; bytes?: number }) {
  return (
    <a className="dlbtn" href={href} download>
      <IconDownload />
      <span>{label}</span>
      {bytes ? <small>{formatBytes(bytes)}</small> : null}
    </a>
  );
}

/** The audiobook player: cover art, play/pause, 15 s skips, a scrub bar, times and speed. */
export function AudioPlayer({
  src,
  title,
  question,
  people,
  countries,
  bytes,
  downloadHref,
  autoPlay = false,
  compact = false,
  tracks,
  credit,
}: {
  src: string;
  title: string;
  question: string;
  people: number;
  countries: number;
  bytes?: number;
  downloadHref?: string;
  autoPlay?: boolean;
  compact?: boolean;
  /** Narrations with chapters (Meta audiobook), one per language. The first is the book's own language. */
  tracks?: AudioTrack[];
  /** Who made the narration, e.g. "Words: Muse Spark · Voice: Meta MMS-TTS". */
  credit?: string;
}) {
  const [trackIndex, setTrackIndex] = useState(0);
  const track = tracks?.[trackIndex] ?? null;
  if (track) {
    src = track.src;
    downloadHref = track.downloadHref;
    bytes = track.bytes;
  }
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [buffering, setBuffering] = useState(false);
  const probed = useDuration(src);
  const length = duration || probed || 0;

  useEffect(() => {
    // Metadata can arrive before hydration attaches the handlers.
    const el = audio.current;
    if (el && el.readyState >= 1 && Number.isFinite(el.duration)) setDuration(el.duration);
  }, [src]);

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    el.playbackRate = speed;
  }, [speed]);

  function toggle() {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setPlaying(false));
    else el.pause();
  }
  function seek(to: number) {
    const el = audio.current;
    if (!el || !Number.isFinite(to)) return;
    el.currentTime = Math.max(0, Math.min(length || to, to));
    setTime(el.currentTime);
  }
  const progress = length ? Math.min(100, (time / length) * 100) : 0;

  return (
    <div className={`aplayer${compact ? " aplayer--compact" : ""}${playing ? " is-playing" : ""}`} data-testid="audio-player">
      <audio
        ref={audio}
        className="aplayer__el read-media__player"
        src={src}
        preload="metadata"
        autoPlay={autoPlay}
        aria-label={`${title} audiobook`}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
      />
      {compact ? null : (
        <div className="aplayer__art" aria-hidden>
          <BookCover compact title={title} question={question} people={people} countries={countries} names={[title]} />
        </div>
      )}
      <div className="aplayer__main">
        {compact ? null : (
          <div className="aplayer__head">
            <span className="label red">Audiobook</span>
            <b className="aplayer__t">{title}</b>
            <span className="aplayer__sub">
              Narrated · the whole book{length ? ` · ${formatTime(length)}` : ""}
            </span>
          </div>
        )}
        <div className="aplayer__controls">
          <button className="aplayer__skip" type="button" onClick={() => seek(time - 15)} aria-label="Back 15 seconds">
            <IconBack15 />
            <small>15</small>
          </button>
          <button className="aplayer__play" type="button" onClick={toggle} aria-label={playing ? "Pause" : "Play"} data-testid="audio-toggle">
            {playing ? <IconPause /> : <IconPlay />}
            {buffering && playing ? <i className="aplayer__spin" aria-hidden /> : null}
          </button>
          <button className="aplayer__skip" type="button" onClick={() => seek(time + 15)} aria-label="Forward 15 seconds">
            <IconFwd15 />
            <small>15</small>
          </button>
          <div className="aplayer__bar">
            <input
              type="range"
              min={0}
              max={length || 0}
              step={0.1}
              value={Math.min(time, length || 0)}
              onChange={(event) => seek(Number(event.target.value))}
              aria-label="Seek"
              style={{ ["--p" as string]: `${progress}%` }}
              disabled={!length}
            />
            <div className="aplayer__times">
              <span>{formatTime(time)}</span>
              <span>{length ? `-${formatTime(Math.max(0, length - time))}` : "--:--"}</span>
            </div>
          </div>
          <button
            className="aplayer__speed"
            type="button"
            onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}
            aria-label={`Speed ${speed} times`}
          >
            {speed}×
          </button>
        </div>
        {tracks && tracks.length > 1 ? (
          <div className="aplayer__langs" role="group" aria-label="Language">
            {tracks.map((item, index) => (
              <button
                key={item.lang}
                type="button"
                className={`aplayer__lang${index === trackIndex ? " is-on" : ""}`}
                aria-pressed={index === trackIndex}
                onClick={() => {
                  setTrackIndex(index);
                  setTime(0);
                  setPlaying(false);
                }}
              >
                {item.name}
              </button>
            ))}
          </div>
        ) : null}
        {track && track.chapters.length > 1 ? (
          <ol className="aplayer__chapters" data-testid="audio-chapters">
            {track.chapters.map((chapter, index) => {
              const start = chapter.startMs / 1000;
              const next = track.chapters[index + 1]?.startMs;
              const on = time >= start && (next === undefined || time < next / 1000);
              return (
                <li key={`${index}-${chapter.startMs}`}>
                  <button
                    type="button"
                    className={on ? "is-on" : ""}
                    onClick={() => {
                      seek(start);
                      const el = audio.current;
                      if (el?.paused) void el.play().catch(() => setPlaying(false));
                    }}
                  >
                    <span>{chapter.title}</span>
                    <small>{formatTime(start)}</small>
                  </button>
                </li>
              );
            })}
          </ol>
        ) : null}
        {downloadHref || credit ? (
          <div className="aplayer__foot">
            {downloadHref ? <DownloadButton href={downloadHref} label="Download MP3" bytes={bytes} /> : null}
            {credit ? <span className="aplayer__credit">{credit}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export type AudioTrack = {
  lang: string;
  name: string;
  src: string;
  downloadHref: string;
  bytes: number;
  chapters: { title: string; startMs: number }[];
};

/** The film: a cover-style poster with a play button; the video loads only when someone presses play. */
export function FilmCard({
  src,
  title,
  question,
  people,
  bytes,
  downloadHref,
  sub,
  credit,
  flags,
  countries,
}: {
  src: string;
  title: string;
  question: string;
  people: number;
  /** Country codes, most voices first: the poster shows their flags behind the title, like the film's opening. */
  flags?: string[];
  countries?: number;
  bytes?: number;
  downloadHref?: string;
  /** What the film is made of, when it is not the plain narration over the cover. */
  sub?: string;
  credit?: string;
}) {
  const [open, setOpen] = useState(false);
  const duration = useDuration(src);
  // Every country at least once; a few countries repeat to fill the wall.
  const codes = (flags ?? []).filter((code) => /^[a-z]{2}$/.test(code));
  const wall = codes.length ? Array.from({ length: Math.min(260, Math.max(codes.length, 40)) }, (_, i) => codes[i % codes.length]) : [];
  return (
    <div className="film" data-testid="film">
      <div className="film__frame">
        {open ? (
          <video className="film__video" src={src} controls autoPlay playsInline preload="metadata" aria-label={`${title} film`} />
        ) : (
          <button className={`film__poster${wall.length ? " film__poster--flags" : ""}`} type="button" onClick={() => setOpen(true)} aria-label={`Play the film of ${title}`}>
            {wall.length ? (
              <span className="film__flags" aria-hidden>
                {wall.map((code, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={`/flags/${code}.svg`} alt="" loading="lazy" decoding="async" />
                ))}
              </span>
            ) : null}
            <span className="film__brand">Book by the People</span>
            <span className="film__title">{title}</span>
            <span className="film__q">{question}</span>
            <span className="film__by">
              {people.toLocaleString("en-US")} {people === 1 ? "voice" : "voices"}
              {countries ? ` · from ${countries.toLocaleString("en-US")} ${countries === 1 ? "country" : "countries"}` : " · read aloud"}
            </span>
            <span className="film__play" aria-hidden>
              <IconPlay />
            </span>
            {duration ? <span className="film__dur">{formatTime(duration)}</span> : null}
          </button>
        )}
      </div>
      <div className="film__foot">
        <div className="film__meta">
          <span className="label red">Film</span>
          <span className="film__sub">{sub || "The narration over the cover"}{duration ? ` · ${formatTime(duration)}` : ""}</span>
          {credit ? <span className="film__credit">{credit}</span> : null}
        </div>
        {downloadHref ? <DownloadButton href={downloadHref} label="Download MP4" bytes={bytes} /> : null}
      </div>
    </div>
  );
}
