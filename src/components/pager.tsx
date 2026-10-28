import Link from "next/link";

/** Prev / page x of y / next. Keeps the search and filter in the links. */
export function Pager({ base, page, pages, params }: { base: string; page: number; pages: number; params: Record<string, string> }) {
  if (pages <= 1) return null;
  const href = (target: number) => {
    const query = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([, value]) => value)) });
    if (target > 1) query.set("page", String(target));
    const text = query.toString();
    return text ? `${base}?${text}` : base;
  };
  return (
    <nav className="pager" aria-label="Pages" data-testid="pager">
      {page > 1 ? (
        <Link className="btn btn--ghost btn--sm" href={href(page - 1)} rel="prev">
          ← Newer
        </Link>
      ) : (
        <span />
      )}
      <span className="pager__n">
        Page <b>{page}</b> of {pages}
      </span>
      {page < pages ? (
        <Link className="btn btn--ghost btn--sm" href={href(page + 1)} rel="next">
          Older →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

/** A plain GET search box (works without JavaScript). */
export function SearchBar({
  action,
  q,
  placeholder,
  children,
}: {
  action: string;
  q: string;
  placeholder: string;
  children?: React.ReactNode;
}) {
  return (
    <form className="findbar" action={action} method="get" role="search">
      <input className="findbar__q" type="search" name="q" defaultValue={q} placeholder={placeholder} aria-label={placeholder} maxLength={80} />
      {children}
      <button className="btn btn--red btn--sm" type="submit">
        Search
      </button>
    </form>
  );
}
