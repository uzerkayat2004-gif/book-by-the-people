"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { IconArrow, IconBook, IconHeadphones, IconPause, IconPlay } from "@/components/icons";
import { LogoMark } from "@/components/logo-mark";

type Clip = { src: string; startMs: number; endMs: number; name: string; text: string };

export function ReadActions({
  href,
  question,
  chapters,
  readMins,
  listenMins,
  clips,
}: {
  href: string;
  question: string;
  chapters: number;
  readMins: number;
  listenMins: number;
  clips: Clip[];
}) {
  const [open, setOpen] = useState<null | "audio" | "video">(null);
  return (
    <>
      <div className="rlw in3">
        <Link className="rlw__read" href={href}>
          <span className="rlw__ic">
            <IconBook />
          </span>
          <span>
            <b>Read</b>
            <small>
              {chapters} {chapters === 1 ? "chapter" : "chapters"} · {readMins} min
            </small>
          </span>
          <IconArrow />
        </Link>
        <button className="rlw__alt" type="button" onClick={() => setOpen("audio")}>
          <span className="rlw__ic">
            <IconHeadphones />
          </span>
          <span>
            <b>Listen</b>
            <small>{listenMins} min</small>
          </span>
        </button>
        <button className="rlw__alt" type="button" onClick={() => setOpen("video")}>
          <span className="rlw__ic">
            <IconPlay />
          </span>
          <span>
            <b>Watch</b>
            <small>{Math.max(1, listenMins)} min</small>
          </span>
        </button>
      </div>
      {open ? <Dock kind={open} clips={clips} question={question} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function clipLength(clip: Clip) {
  return Math.max(0.4, (clip.endMs - clip.startMs) / 1000);
}

function clock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function Dock({ kind, clips, question, onClose }: { kind: "audio" | "video"; clips: Clip[]; question: string; onClose: () => void }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const pendingOffset = useRef(0);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [full, setFull] = useState(kind === "video");
  const [rate, setRate] = useState(1);
  const [local, setLocal] = useState(0);
  const lengths = clips.map(clipLength);
  const total = lengths.reduce((sum, length) => sum + length, 0) || 1;
  const before = lengths.slice(0, index).reduce((sum, length) => sum + length, 0);
  const global = Math.min(total, before + local);
  const clip = clips[index];
  const video = kind === "video";

  useEffect(() => {
    document.body.classList.add("has-dock");
    if (full) document.body.classList.add("dock-full");
    return () => {
      document.body.classList.remove("has-dock");
      document.body.classList.remove("dock-full");
    };
  }, [full]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !clip) return;
    audio.src = clip.src;
    audio.playbackRate = rate;
    const start = Math.max(0, clip.startMs / 1000) + pendingOffset.current;
    pendingOffset.current = 0;
    const begin = () => {
      audio.currentTime = start;
      void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    };
    if (audio.readyState >= 1) begin();
    else audio.addEventListener("loadedmetadata", begin, { once: true });
    // Rate changes apply on the live element. Reloading here would restart the clip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip]);

  function seekGlobal(next: number) {
    const target = Math.max(0, Math.min(total - 0.05, next));
    let cursor = 0;
    for (let i = 0; i < clips.length; i += 1) {
      if (cursor + lengths[i] > target || i === clips.length - 1) {
        const offset = Math.max(0, target - cursor);
        pendingOffset.current = offset;
        setLocal(offset);
        if (i === index) {
          const audio = audioRef.current;
          if (audio && clips[i]) audio.currentTime = clips[i].startMs / 1000 + offset;
          return;
        }
        setIndex(i);
        return;
      }
      cursor += lengths[i];
    }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div id="dock">,
      <div className={`mp${playing ? " playing" : ""}${full ? " full" : ""} ${video ? "is-video" : "is-audio"}`} role="region" aria-label={video ? "Video player" : "Audio player"}>
        <button className="mp__media" type="button" onClick={() => setFull(true)} aria-label="Expand">
          {video ? (
            <span className="mp__poster">
              <LogoMark className="mp__logo" />
              <strong>
                Written by
                <br />
                <em>the people.</em>
              </strong>
              <small>Book 1 · {question}</small>
            </span>
          ) : (
            <span className="mp__art">
              <LogoMark className="mp__logo" />
              <span className="mp__eq">
                <i />
                <i />
                <i />
                <i />
              </span>
            </span>
          )}
        </button>
        <div className="mp__meta">
          <b>Book by the People</b>
          <span>{video ? "Video" : "Audio"} · Book 1</span>
        </div>
        <div className="mp__bar">
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round((global / total) * 1000)}
            aria-label="Seek"
            style={{ ["--p" as string]: `${(global / total) * 100}%` }}
            onChange={(event) => seekGlobal((Number(event.target.value) / 1000) * total)}
          />
          <div className="mp__times">
            <span>{clock(global)}</span>
            <span>{clock(total)}</span>
          </div>
        </div>
        <div className="mp__ctl">
          <button className="mp__b mp__sk" type="button" aria-label="Back 15 seconds" onClick={() => seekGlobal(global - 15)}>
            <SkipIcon back />
          </button>
          <button
            className="mp__b mp__pp"
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            onClick={() => {
              const audio = audioRef.current;
              if (!audio) return;
              if (audio.paused) void audio.play();
              else audio.pause();
            }}
          >
            {playing ? <IconPause /> : <IconPlay />}
          </button>
          <button className="mp__b mp__sk" type="button" aria-label="Forward 15 seconds" onClick={() => seekGlobal(global + 15)}>
            <SkipIcon />
          </button>
          <button
            className="mp__b mp__rate"
            type="button"
            aria-label="Speed"
            onClick={() => {
              const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
              setRate(next);
              if (audioRef.current) audioRef.current.playbackRate = next;
            }}
          >
            {rate === 1 ? "1×" : `${rate}×`}
          </button>
          {video ? (
            <button className="mp__b" type="button" aria-label="Picture in picture" onClick={() => setFull(false)}>
              <PipIcon />
            </button>
          ) : null}
          <button className="mp__b mp__exp" type="button" aria-label={full ? "Minimise" : "Expand"} onClick={() => setFull((value) => !value)}>
            <ChevronIcon up={!full} />
          </button>
          <button className="mp__b mp__close" type="button" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <audio
          ref={audioRef}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(event) => {
            const audio = event.currentTarget;
            if (!clip) return;
            const start = clip.startMs / 1000;
            const into = Math.max(0, audio.currentTime - start);
            setLocal(into);
            if (clip.endMs > clip.startMs && audio.currentTime * 1000 >= clip.endMs - 40) {
              if (index + 1 < clips.length) setIndex(index + 1);
              else audio.pause();
            }
          }}
          onEnded={() => {
            if (index + 1 < clips.length) setIndex(index + 1);
          }}
        />
      </div>
    </div>,
    document.body,
  );
}

function SkipIcon({ back }: { back?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {back ? (
        <>
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
          <path d="M3 3v5h5" />
        </>
      ) : (
        <>
          <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
          <path d="M21 3v5h-5" />
        </>
      )}
      <text x="12" y="15.5" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="currentColor" stroke="none">
        15
      </text>
    </svg>
  );
}

function ChevronIcon({ up }: { up?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={up ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function PipIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
      <rect x="12" y="11" width="7" height="6" rx="1.2" fill="currentColor" />
    </svg>
  );
}
