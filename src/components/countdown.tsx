"use client";

import { useEffect, useState } from "react";

function parts(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return {
    d: Math.floor(seconds / 86400),
    h: Math.floor((seconds % 86400) / 3600),
    m: Math.floor((seconds % 3600) / 60),
    s: seconds % 60,
  };
}

const pad = (value: number) => String(value).padStart(2, "0");

export function Countdown({ closesAt, frozen }: { closesAt: string | null; frozen?: boolean }) {
  // Start from the real time left (also on the server), so the first paint is never all zeros.
  const [left, setLeft] = useState(() =>
    frozen || !closesAt ? { d: 0, h: 0, m: 0, s: 0 } : parts(new Date(closesAt).getTime() - Date.now()),
  );
  useEffect(() => {
    if (frozen || !closesAt) return;
    const tick = () => setLeft(parts(new Date(closesAt).getTime() - Date.now()));
    const start = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(timer);
    };
  }, [closesAt, frozen]);
  const cells = [
    ["d", "days", left.d],
    ["h", "hrs", left.h],
    ["m", "min", left.m],
    ["s", "sec", left.s],
  ] as const;
  return (
    <div className="cd" aria-label={frozen ? "Voices are closed" : "Voices close in"} role="timer">
      {cells.map(([key, label, value]) => (
        <div className="cd__b" key={key}>
          <b data-cd={key} suppressHydrationWarning>{pad(value)}</b>
          <small>{label}</small>
        </div>
      ))}
    </div>
  );
}
