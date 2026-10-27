"use client";

import { useId } from "react";

function splitLines(text: string) {
  const words = text.split(" ");
  if (words.length < 2) return [text];
  let best = [text];
  let score = 1e9;
  for (let index = 1; index < words.length; index += 1) {
    const a = words.slice(0, index).join(" ");
    const b = words.slice(index).join(" ");
    const delta = Math.abs(a.length - b.length);
    if (delta < score) {
      score = delta;
      best = [a, b];
    }
  }
  return best;
}

export function BookCover({
  question,
  people,
  countries,
  names,
  compact = false,
  title,
}: {
  question: string;
  people: number;
  countries: number;
  names: string[];
  compact?: boolean;
  title?: string;
}) {
  const id = useId().replace(/:/g, "");
  const custom = title && title.trim().toLowerCase() !== "book by the people" ? title.trim().toUpperCase() : null;
  const lines = custom ? (custom.length > 12 ? splitLines(custom) : [custom]) : ["BOOK BY", "THE PEOPLE"];
  const sub = splitLines(question);
  const longest = Math.max(...lines.map((line) => line.length));
  const size = Math.min(50, 204 / (longest * 0.4));
  const texture = names.length ? names.join("  ·  ") : "voices";
  const nameLines = Array.from({ length: 13 }, (_, index) => texture.slice((index * 17) % Math.max(texture.length, 1)).padEnd(48, " · "));
  return (
    <div className={compact ? "bk6 bk6--compact" : "bk6"} aria-label={`Book by the People — ${question}`}>
      <svg className="bk6__svg" viewBox="0 0 400 560" role="img">
        <defs>
          <linearGradient id={`bkCov${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ec4245" />
            <stop offset=".45" stopColor="#bd252c" />
            <stop offset=".8" stopColor="#86141b" />
            <stop offset="1" stopColor="#4e0b10" />
          </linearGradient>
          <linearGradient id={`bkLight${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".26" />
            <stop offset=".38" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity=".32" />
          </linearGradient>
          <linearGradient id={`bkSpine${id}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#000" stopOpacity=".45" />
            <stop offset=".45" stopColor="#fff" stopOpacity=".1" />
            <stop offset="1" stopColor="#000" stopOpacity=".18" />
          </linearGradient>
          <linearGradient id={`bkPages${id}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#d9d0bf" />
            <stop offset=".35" stopColor="#f8f4ec" />
            <stop offset="1" stopColor="#cfc5b2" />
          </linearGradient>
          <linearGradient id={`bkTop${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fffdf8" />
            <stop offset="1" stopColor="#e6dece" />
          </linearGradient>
          <clipPath id={`bkClip${id}`}>
            <path d="M33 50H322a8 8 0 0 1 8 8V512a8 8 0 0 1-8 8H33a3 3 0 0 1-3-3V53a3 3 0 0 1 3-3z" />
          </clipPath>
        </defs>
        <ellipse cx="200" cy="532" rx="168" ry="14" fill="#000" opacity=".55" />
        <path d="M60 34H348a8 8 0 0 1 8 8V496a8 8 0 0 1-8 8H60a3 3 0 0 1-3-3V37a3 3 0 0 1 3-3z" fill="#3d0a0e" />
        <path d="M36 51 62 35H350l-25 16z" fill={`url(#bkTop${id})`} />
        <path d="M326 56 352 40V500l-26 15z" fill={`url(#bkPages${id})`} />
        <g clipPath={`url(#bkClip${id})`}>
          <rect x="30" y="50" width="300" height="470" fill={`url(#bkCov${id})`} />
          {(
          <g fontFamily="Geist Mono, monospace" fontSize="5.2" fill="#fff" fillOpacity=".05">
            {nameLines.map((line, index) => (
              <text key={index} x="52" y={120 + index * 7.4}>
                {line}
              </text>
            ))}
          </g>
          )}
          <rect x="30" y="50" width="16" height="470" fill={`url(#bkSpine${id})`} />
          <clipPath id={`bkIcon${id}`}>
            <rect x="66" y="80" width="44" height="44" rx="10" />
          </clipPath>
          <rect x="66" y="80" width="44" height="44" rx="10" fill="#0b0b0d" />
          <image href="/apple-touch-icon.png" x="66" y="80" width="44" height="44" clipPath={`url(#bkIcon${id})`} preserveAspectRatio="xMidYMid slice" />
          <text x="306" y="98" textAnchor="end" fontFamily="Geist Mono, monospace" fontSize="10" letterSpacing="4.2" fill="#fff" fillOpacity=".72">
            VOL. 1
          </text>
          {lines.map((line, index) => (
            <text
              key={line}
              x="62"
              y={304 + index * size * 0.86}
              fontFamily="Archivo, sans-serif"
              fontWeight="850"
              fontSize={size}
              letterSpacing="-0.3"
              fill="#fcebe8"
              style={{ fontStretch: "64%" }}
            >
              {line}
            </text>
          ))}
          {sub.slice(0, 3).map((line, index) => (
            <text key={line} x="63" y={304 + (lines.length - 1) * size * 0.86 + 38 + index * 25} fontFamily="Newsreader, serif" fontStyle="italic" fontSize="19.5" fill="#fff" fillOpacity=".9">
              {line}
            </text>
          ))}
          <path d="M63 455H306" stroke="#fff" strokeOpacity=".28" />
          <text x="63" y="482" fontFamily="Geist, sans-serif" fontSize="11.5" fill="#fff" fillOpacity=".88">
            {people > 0 ? (
              <>
                by <tspan fontWeight="700">{people.toLocaleString("en-US")}</tspan> {people === 1 ? "person" : "people"} from <tspan fontWeight="700">{countries}</tspan> {countries === 1 ? "country" : "countries"}
              </>
            ) : compact ? null : (
              "by the people · opens soon"
            )}
          </text>
          <rect x="30" y="50" width="300" height="470" fill={`url(#bkLight${id})`} />
        </g>
        <path d="M33 50H322a8 8 0 0 1 8 8V512a8 8 0 0 1-8 8H33a3 3 0 0 1-3-3V53a3 3 0 0 1 3-3z" fill="none" stroke="#fff" strokeOpacity=".14" />
      </svg>
    </div>
  );
}
