import { flagEmoji } from "@/lib/countries";

export function NamesMarquee({ names }: { names: { name: string; countryCode: string | null; region?: string }[] }) {
  const source = names.length ? names : [{ name: "Your name", countryCode: null, region: "" }];
  const row = (index: number) => {
    const picked = source.filter((_, item) => item % 2 === index);
    const base = (picked.length ? picked : source).flatMap((person) => Array.from({ length: 6 }, () => person));
    const track = [...base, ...base];
    return (
      <div className={`nrow${index ? " rev" : ""}`} key={index}>
        <div className="nrow__track">
          {track.map((person, item) => (
            <span className="nm" key={`${person.name}-${item}`}>
              {person.name} {person.countryCode ? <i>{flagEmoji(person.countryCode)}</i> : null}
              {person.region ? <i>{person.region}</i> : null}
            </span>
          ))}
        </div>
      </div>
    );
  };
  return (
    <section className="names4" aria-label="Everyone who has spoken">
      <div className="wrap names4__head">
        <span className="label">
          <b>{names.length.toLocaleString("en-US")}</b> names
        </span>
      </div>
      {row(0)}
      {row(1)}
    </section>
  );
}
