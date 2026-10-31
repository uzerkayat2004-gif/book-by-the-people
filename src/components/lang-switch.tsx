import { languageName } from "@/lib/i18n";

/** A small language picker for a released book. Plain links, so it works without JavaScript. */
export function LangSwitch({ languages, current, href, label }: { languages: string[]; current: string; href: (code: string) => string; label: string }) {
  if (languages.length < 2) return null;
  return (
    <details className="langsw" data-testid="lang-switch">
      <summary aria-label={label}>
        <svg viewBox="0 0 24 24" width={15} height={15} aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
        </svg>
        <span>{languageName(current, current)}</span>
      </summary>
      <ul>
        {languages.map((code) => (
          <li key={code}>
            <a href={href(code)} lang={code} aria-current={code === current ? "true" : undefined} className={code === current ? "on" : ""}>
              {languageName(code, code)}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
