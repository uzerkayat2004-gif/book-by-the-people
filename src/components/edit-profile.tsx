"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { COUNTRIES, flagEmoji } from "@/lib/countries";
import { AGE_BANDS } from "@/lib/regions";

export function EditProfile({
  name,
  handle,
  ageBand,
  countryCode,
  region,
}: {
  name: string;
  handle: string;
  ageBand: string;
  countryCode: string;
  region: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nextName, setNextName] = useState(name);
  const [nextHandle, setNextHandle] = useState(handle);
  const [nextAge, setNextAge] = useState(ageBand);
  const [nextCountry, setNextCountry] = useState(countryCode || "IN");
  const [nextRegion, setNextRegion] = useState(region);
  async function save() {
    await fetch("/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: nextName,
        handle: nextHandle,
        ageBand: nextAge,
        countryCode: nextCountry,
        region: nextRegion,
      }),
    });
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button className="btn btn--ghost btn--sm" type="button" onClick={() => setOpen(true)}>
        Edit
      </button>
      {open ? (
        <div className="scrim open" onClick={() => setOpen(false)}>
          <div className="sheet sheet--profile" role="dialog" aria-label="About you" onClick={(event) => event.stopPropagation()}>
            <div className="grab" />
            <div className="stepdots">
              <i className="on" />
              <i className="on" />
              <i />
              <i />
            </div>
            <div className="label red">About you</div>
            <label className="field">
              <span>Your name</span>
              <input className="input" value={nextName} onChange={(event) => setNextName(event.target.value)} />
            </label>
            <label className="field">
              <span>X username</span>
              <div className="at">
                <input className="input" value={nextHandle} onChange={(event) => setNextHandle(event.target.value.replace(/^@/, ""))} />
              </div>
            </label>
            <div className="field">
              <span>Age</span>
              <div className="seg">
                {AGE_BANDS.map((band) => (
                  <button key={band} type="button" className={nextAge === band ? "on" : ""} onClick={() => setNextAge(band)}>
                    {band}
                  </button>
                ))}
              </div>
            </div>
            <label className="field">
              <span>Country</span>
              <select className="input" value={nextCountry} onChange={(event) => setNextCountry(event.target.value)}>
                {COUNTRIES.map((item) => (
                  <option key={item.code} value={item.code}>
                    {flagEmoji(item.code)} {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>State / region</span>
              <input className="input" value={nextRegion} onChange={(event) => setNextRegion(event.target.value)} />
            </label>
            <button className="btn btn--red btn--big btn--block" type="button" onClick={() => void save()}>
              Continue
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
