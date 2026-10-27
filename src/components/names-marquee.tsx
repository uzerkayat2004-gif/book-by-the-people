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
              {person.name} {person.countryCode && /^[a-z]{2}$/i.test(person.countryCode) ? (
                <i>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`https://flagcdn.com/24x18/${person.countryCode.toLowerCase()}.png`} alt="" width={18} height={14} loading="lazy" className="nm__flag" />
                </i>
              ) : null}
              {person.region ? <i>{person.region}</i> : null}
            </span>
          ))}
        </div>
      </div>
    );
  };
  return (
    <section className="wrap names4" aria-label="Everyone who has spoken">
      <div className="names4__head">
        <span className="label">
          <b>{names.length.toLocaleString("en-US")}</b> names
        </span>
      </div>
      {row(0)}
      {row(1)}
    </section>
  );
}
