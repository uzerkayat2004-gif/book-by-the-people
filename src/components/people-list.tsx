"use client";

import { useState } from "react";
import { flagEmoji } from "@/lib/countries";

export type Person = { name: string; countryCode: string | null; place: string };

const SHOWN = 8;

/** Who has spoken so far: name and place only. Their words stay sealed until release. */
export function PeopleList({ people, showAll, showLess }: { people: Person[]; showAll: string; showLess: string }) {
  const [open, setOpen] = useState(false);
  if (!people.length) return null;
  const list = open ? people : people.slice(0, SHOWN);
  return (
    <div className="gpeople" data-testid="people-list">
      <ul className={open && people.length > 14 ? "gpeople__ul is-tall" : "gpeople__ul"}>
        {list.map((person, index) => (
          <li key={`${person.name}-${index}`} data-testid="person">
            <span className="gpeople__flag" aria-hidden>
              {person.countryCode ? flagEmoji(person.countryCode) : "🌍"}
            </span>
            <b className="gpeople__name">{person.name}</b>
            {person.place ? <span className="gpeople__place">{person.place}</span> : null}
          </li>
        ))}
      </ul>
      {people.length > SHOWN ? (
        <button type="button" className="gpeople__more" onClick={() => setOpen((value) => !value)} data-testid="people-more">
          {open ? showLess : `${showAll} · ${people.length}`}
        </button>
      ) : null}
    </div>
  );
}
