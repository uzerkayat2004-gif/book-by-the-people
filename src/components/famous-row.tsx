import { IconCheck, IconX } from "@/components/icons";
import { FAMOUS_SAMPLES, scramble } from "@/lib/famous-samples";

function Tweet({ person, open, hidden }: { person: (typeof FAMOUS_SAMPLES)[number]; open: boolean; hidden?: boolean }) {
  return (
    <article className="tw" style={{ ["--c" as string]: person.col }} aria-hidden={hidden || undefined}>
      <header className="tw__h">
        <span className="tw__av">{person.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>
        <span className="tw__id">
          <b>
            {person.name}
            <span className="vtick">
              <IconCheck size={14} />
            </span>
          </b>
          <span>@{person.handle}</span>
        </span>
        <span className="tw__x">
          <IconX />
        </span>
      </header>
      {open ? (
        <p className="tw__t">{person.q}</p>
      ) : (
        <div className="tw__seal">
          <p className="tw__t" aria-hidden="true">
            {scramble(person.q)}
          </p>
          <span className="tw__lock">Sealed</span>
        </div>
      )}
      <div className="tw__time">{person.t}</div>
      <footer className="tw__a">
        <span>{person.r}</span>
        <span>{person.rt}</span>
        <span>{person.l}</span>
      </footer>
    </article>
  );
}

export function FamousRow({ open }: { open: boolean }) {
  const rows = [FAMOUS_SAMPLES.slice(0, 4), FAMOUS_SAMPLES.slice(4, 8)];
  return (
    <section className="section famous6" id="famous">
      <div className="wrap section__head rv in">
        <h2>Famous voices</h2>
        <span className="samplechip">Fictional samples</span>
      </div>
      {rows.map((row, index) => (
        <div className={`mq${index ? " mq--rev" : ""}`} key={index}>
          <div className="mq__track">
            {[...row, ...row].map((person, item) => (
              <Tweet key={`${person.handle}-${item}`} person={person} open={open} hidden={item >= row.length} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
