"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BOOK_LANGUAGES, bookLanguage } from "@/lib/languages";

type State = { language: string; name: string; status: "waiting" | "working" | "ready" | "failed"; done: number; total: number; error: string };

/**
 * Release in more languages: pick extras, and the released book is translated into each one with
 * this book's AI. Readers get a language switch on the book page.
 */
export function ReleaseLanguages({ bookId, bookLang, published, initial }: { bookId: string; bookLang: string; published: boolean; initial: string[] }) {
  const [picked, setPicked] = useState<string[]>(initial);
  const [states, setStates] = useState<State[]>([]);
  const [adding, setAdding] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const live = useRef(true);

  const call = useCallback(
    async (body: { languages?: string[]; run?: boolean; retry?: boolean }) => {
      const response = await fetch(`/api/books/${bookId}/translations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => null);
      const data = response ? ((await response.json().catch(() => ({}))) as { languages?: State[]; error?: string }) : {};
      if (!response?.ok) throw new Error(data.error || "That didn't save. Try again.");
      return data.languages ?? [];
    },
    [bookId],
  );

  // Keep translating while the Studio is open: each call does a part and saves it.
  const pump = useCallback(
    async (retry = false) => {
      setBusy(true);
      setError("");
      try {
        let next = await call({ run: true, retry });
        if (live.current) setStates(next);
        while (live.current && next.some((item) => item.status === "working")) {
          next = await call({ run: true });
          if (live.current) setStates(next);
        }
      } catch (problem) {
        if (live.current) setError((problem as Error).message);
      } finally {
        if (live.current) setBusy(false);
      }
    },
    [call],
  );

  useEffect(() => {
    live.current = true;
    const id = setTimeout(() => {
      if (published && initial.length) void pump();
      else void call({}).then((next) => live.current && setStates(next)).catch(() => undefined);
    }, 0);
    return () => {
      live.current = false;
      clearTimeout(id);
    };
    // Run once when the tab opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(next: string[]) {
    setPicked(next);
    setError("");
    try {
      setStates(await call({ languages: next }));
      if (published && next.length) void pump();
    } catch (problem) {
      setError((problem as Error).message);
    }
  }

  const choices = BOOK_LANGUAGES.filter((item) => item.code !== bookLang && !picked.includes(item.code));
  return (
    <div className="rl" data-testid="release-languages">
      <div className="rl__head">
        <b>Languages</b>
        <span>
          Written in {bookLanguage(bookLang).name}. Add more and the released book is translated with your AI.
        </span>
      </div>
      <ul className="rl__list">
        <li className="rl__item rl__item--main">
          <span>{bookLanguage(bookLang).name}</span>
          <em>Main</em>
        </li>
        {picked.map((code) => {
          const state = states.find((item) => item.language === code);
          const label = !published
            ? "On release"
            : !state || state.status === "waiting"
              ? "Waiting"
              : state.status === "ready"
                ? "Ready"
                : state.status === "failed"
                  ? "Stopped"
                  : `Translating ${state.total ? Math.round((state.done / state.total) * 100) : 0}%`;
          return (
            <li key={code} className={`rl__item is-${state?.status ?? "waiting"}`} data-testid={`release-lang-${code}`}>
              <span>{bookLanguage(code).name}</span>
              <em>{label}</em>
              {state?.status === "failed" ? (
                <button type="button" className="s2-link" onClick={() => void pump(true)} disabled={busy}>
                  Try again
                </button>
              ) : null}
              <button type="button" className="rl__x" aria-label={`Remove ${bookLanguage(code).name}`} onClick={() => void save(picked.filter((item) => item !== code))}>
                ×
              </button>
            </li>
          );
        })}
      </ul>
      <div className="rl__add">
        <select className="s2-input s2-sel" aria-label="Add a language" data-testid="release-lang-add" value={adding} onChange={(event) => setAdding(event.target.value)}>
          <option value="">Add a language…</option>
          {choices.map((item) => (
            <option key={item.code} value={item.code}>
              {item.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="s2-btn s2-btn--ghost"
          disabled={!adding || picked.length >= 12}
          onClick={() => {
            const code = adding;
            setAdding("");
            void save([...picked, code]);
          }}
        >
          Add
        </button>
      </div>
      {states.find((item) => item.status === "failed")?.error ? <p className="rl__err">{states.find((item) => item.status === "failed")!.error}</p> : null}
      {error ? <p className="rl__err">{error}</p> : null}
    </div>
  );
}
