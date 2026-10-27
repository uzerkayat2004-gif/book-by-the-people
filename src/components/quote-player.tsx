"use client";

import { useRef, useState } from "react";

export function QuotePlayer({
  src,
  startMs,
  endMs,
  testId = "play-quote",
}: {
  src: string;
  startMs: number;
  endMs: number;
  testId?: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  async function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      setPlaying(false);
      return;
    }
    audio.currentTime = Math.max(0, startMs / 1000);
    try {
      await audio.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  }

  return (
    <>
      <button
        type="button"
        data-testid={testId}
        onClick={toggle}
        aria-label={playing ? "Pause the original voice" : "Play the original voice"}
        className="playdot"
      >
        {playing ? (
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <rect x="6" y="4.5" width="4" height="15" rx="1" />
            <rect x="14" y="4.5" width="4" height="15" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
      <audio
        ref={audioRef}
        src={src}
        preload="none"
        onTimeUpdate={(event) => {
          const audio = event.currentTarget;
          if (endMs > startMs && audio.currentTime * 1000 >= endMs - 30) {
            audio.pause();
            setPlaying(false);
          }
        }}
        onEnded={() => setPlaying(false)}
      />
    </>
  );
}
