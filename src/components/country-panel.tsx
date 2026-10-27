"use client";

import { useState } from "react";
import { flagEmoji } from "@/lib/countries";
import { shortCountry } from "@/lib/stage";
import { IconArrow } from "@/components/icons";

export type CountryRow = { code: string; name: string; count: number };

export function CountryPanel({ countries, voiceCount }: { countries: CountryRow[]; voiceCount: number }) {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const top = countries.slice(0, 5);
  const max = Math.max(1, ...top.map((country) => country.count));
  const rest = Math.max(0, countries.length - top.length);
  const focused = countries.find((country) => country.code === focus);
  return (
    <>
      <div className="gpanel">
        <div className="gpanel__stats">
          <span>
            <b>{countries.length}</b>countries
          </span>
          <span>
            <b>{voiceCount.toLocaleString("en-US")}</b>voices
          </span>
        </div>
        <ol className="gpanel__list">
          {top.map((country, index) => (
            <li key={country.code}>
              <button type="button" onClick={() => setFocus(country.code)}>
                <span className="gp__rk">{index + 1}</span>
                <span className="gp__cc">{country.code}</span>
                <span className="gp__nm">{shortCountry(country.code, country.name)}</span>
                <span className="gp__bar">
                  <i style={{ width: `${(country.count / max) * 100}%` }} />
                </span>
                <b>{country.count}</b>
              </button>
            </li>
          ))}
        </ol>
        {countries.length > 5 ? (
          <button className="gpanel__more" type="button" onClick={() => setOpen(true)}>
            +{rest} more countries <IconArrow size={14} />
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="scrim open" onClick={() => setOpen(false)}>
          <div className="sheet" role="dialog" aria-label="All countries" onClick={(event) => event.stopPropagation()}>
            <div className="grab" />
            <h3>
              {countries.length} {countries.length === 1 ? "country" : "countries"}
            </h3>
            <div className="names">
              {countries.map((country) => (
                <button key={country.code} className="pill" type="button" onClick={() => setFocus(country.code)}>
                  {flagEmoji(country.code)} {country.name} <b>{country.count}</b>
                </button>
              ))}
            </div>
            <button className="btn btn--block" type="button" onClick={() => setOpen(false)} style={{ marginTop: 16 }}>
              Close
            </button>
          </div>
        </div>
      ) : null}
      {focused ? (
        <div className="scrim open" onClick={() => setFocus(null)}>
          <div className="sheet" role="dialog" aria-label={focused.name} onClick={(event) => event.stopPropagation()}>
            <div className="grab" />
            <div className="label red">Voices</div>
            <h3>
              {flagEmoji(focused.code)} {focused.name} · {focused.count}
            </h3>
            <p className="soft">Names from this country are in the strip below. Words stay sealed until the book is out.</p>
            <button className="btn btn--block" type="button" onClick={() => setFocus(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
