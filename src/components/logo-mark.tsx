"use client";

import { useId } from "react";

export function LogoMark({ className = "logo__mark" }: { className?: string }) {
  const raw = useId().replace(/:/g, "");
  const bg = `lgBg${raw}`;
  const ink = `lgPg${raw}`;
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ef4a4c" />
          <stop offset=".55" stopColor="#c92e34" />
          <stop offset="1" stopColor="#8e161c" />
        </linearGradient>
        <linearGradient id={ink} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#f1e9e6" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="32" fill="#14161c" />
      <circle cx="32" cy="32" r="31" fill="none" stroke="#fff" strokeOpacity=".14" />
      <g fill="#f4f1ea" transform="translate(8 6) scale(.75)">
        <path d="M8 27C15 23.2 23.2 23.4 30.4 27.8V51.5C23.2 47.2 15 47 8 50.6Z" />
        <path d="M56 27C49 23.2 40.8 23.4 33.6 27.8V51.5C40.8 47.2 49 47 56 50.6Z" />
        <rect x="21.6" y="13.5" width="4.8" height="7.5" rx="2.4" />
        <rect x="29.6" y="8" width="4.8" height="13" rx="2.4" />
        <rect x="37.6" y="13.5" width="4.8" height="7.5" rx="2.4" />
      </g>
    </svg>
  );
}
