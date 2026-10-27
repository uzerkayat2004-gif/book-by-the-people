"use client";

import { useId } from "react";

function questionLines(text: string) {
  return splitLines(text).slice(0, 3);
}

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
}: {
  question: string;
  people: number;
  countries: number;
  names: string[];
  compact?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const lines = ["BOOK BY", "THE PEOPLE"];
  const sub = splitLines(question);
  const longest = Math.max(...lines.map((line) => line.length));
  const size = Math.min(52, 236 / (longest * 0.52));
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
          {compact ? null : (
          <g fontFamily="Geist Mono, monospace" fontSize="5.2" fill="#fff" fillOpacity=".11">
            {nameLines.map((line, index) => (
              <text key={index} x="52" y={120 + index * 7.4}>
                {line}
              </text>
            ))}
          </g>
          )}
          <rect x="30" y="50" width="16" height="470" fill={`url(#bkSpine${id})`} />
          <g transform="translate(64 74) scale(.7)" fill="#fbe4e1">
            <path d="M8 27C15 23.2 23.2 23.4 30.4 27.8V51.5C23.2 47.2 15 47 8 50.6Z" />
            <path d="M56 27C49 23.2 40.8 23.4 33.6 27.8V51.5C40.8 47.2 49 47 56 50.6Z" />
            <rect x="21.6" y="13.5" width="4.8" height="7.5" rx="2.4" />
            <rect x="29.6" y="8" width="4.8" height="13" rx="2.4" />
            <rect x="37.6" y="13.5" width="4.8" height="7.5" rx="2.4" />
          </g>
          <text x={compact ? 292 : 306} y={compact ? 88 : 96} textAnchor="end" fontFamily="Geist Mono, monospace" fontSize={compact ? 8 : 10.5} letterSpacing={compact ? 1.6 : 2.4} fill="#fff" fillOpacity=".78">
            VOL. 1
          </text>
          {lines.map((line, index) => (
            <text
              key={line}
              x={compact ? 54 : 64}
              y={(compact ? 168 : 250) + index * (compact ? 28 : size * 0.92)}
              fontFamily="Archivo, sans-serif"
              fontWeight="850"
              fontSize={compact ? 26 : size}
              letterSpacing={compact ? -0.4 : 0}
              fill="#fcebe8"
              style={{ fontStretch: compact ? "68%" : "64%" }}
            >
              {line}
            </text>
          ))}
          {(compact ? questionLines(question) : sub).map((line, index) => (
            <text key={line} x={compact ? 54 : 65} y={(compact ? 236 : 250 + lines.length * size * 0.92 + 28) + index * (compact ? 14 : 24)} fontFamily="Newsreader, serif" fontStyle="italic" fontSize={compact ? 11 : 18} letterSpacing={compact ? 0.2 : 0} fill="#fff" fillOpacity=".92">
              {line}
            </text>
          ))}
          {compact ? null : (
            <>
          <path d="M65 456H306" stroke="#fff" strokeOpacity=".3" />
          <text x="65" y="478" fontFamily="Geist, sans-serif" fontSize="12.5" fill="#fff" fillOpacity=".86">
            By <tspan fontWeight="700">{people.toLocaleString("en-US")}</tspan> people
          </text>
          <text x="65" y="496" fontFamily="Geist, sans-serif" fontSize="12.5" fill="#fff" fillOpacity=".86">
            from <tspan fontWeight="700">{countries}</tspan> countries
          </text>
            </>
          )}
          <rect x="30" y="50" width="300" height="470" fill={`url(#bkLight${id})`} />
        </g>
        <path d="M33 50H322a8 8 0 0 1 8 8V512a8 8 0 0 1-8 8H33a3 3 0 0 1-3-3V53a3 3 0 0 1 3-3z" fill="none" stroke="#fff" strokeOpacity=".14" />
      </svg>
    </div>
  );
}
