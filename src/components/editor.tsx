"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { QuotePlayer } from "@/components/quote-player";
import type { BookDocument } from "@/lib/book/types";

export function Editor({ bookId, slug, initial }: { bookId: string; slug: string; initial: BookDocument }) {
  const router = useRouter();
  const [preface, setPreface] = useState(initial.preface);
  const [chapters, setChapters] = useState(
    initial.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      narrative: chapter.narrative,
      quotes: chapter.quotes,
      hidden: new Set(chapter.quotes.filter((quote) => quote.hidden).map((quote) => quote.id)),
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/books/${bookId}/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        preface,
        chapters: chapters.map((chapter) => ({
          id: chapter.id,
          title: chapter.title,
          narrative: chapter.narrative,
          hiddenQuoteIds: [...chapter.hidden],
        })),
      }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(data.error ?? "The edit was not saved.");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <div className="ai__head">
        <div>
          <p className="label">Editor · quotations stay verbatim</p>
          <h1>{initial.title}</h1>
        </div>
        <div className="studio-actions">
          <button className="btn btn--red btn--sm" type="button" onClick={() => void save()} disabled={busy}>
            {busy ? "Saving…" : "Save a new version"}
          </button>
          <button
            className="btn btn--sm"
            type="button"
            onClick={async () => {
              await fetch(`/api/books/${bookId}/publish`, { method: "POST" });
              router.push(`/b/${slug}/read`);
              router.refresh();
            }}
          >
            Publish
          </button>
        </div>
      </div>
      {error ? <p className="err">{error}</p> : null}
      <textarea className="ta" value={preface} onChange={(event) => setPreface(event.target.value)} aria-label="Preface" />
      {chapters.map((chapter, index) => (
        <section key={chapter.id} className="card bl" style={{ marginTop: 14 }}>
          <input
            className="input"
            aria-label={`Chapter ${index + 1} title`}
            value={chapter.title}
            onChange={(event) =>
              setChapters((current) => current.map((item) => (item.id === chapter.id ? { ...item, title: event.target.value } : item)))
            }
          />
          <textarea
            className="ta"
            style={{ marginTop: 10 }}
            aria-label={`Chapter ${index + 1} narrative`}
            value={chapter.narrative}
            onChange={(event) =>
              setChapters((current) => current.map((item) => (item.id === chapter.id ? { ...item, narrative: event.target.value } : item)))
            }
          />
          <ul>
            {chapter.quotes.map((quote) => {
              const hidden = chapter.hidden.has(quote.id);
              return (
                <li key={quote.id} className="pq" style={{ opacity: hidden ? 0.4 : 1, listStyle: "none" }}>
                  <p>
                    {quote.hasAudio ? <QuotePlayer src={`/api/audio/${quote.voiceId}`} startMs={quote.startMs} endMs={quote.endMs} /> : null} {quote.originalText}
                  </p>
                  <button
                    type="button"
                    className="link"
                    onClick={() =>
                      setChapters((current) =>
                        current.map((item) => {
                          if (item.id !== chapter.id) return item;
                          const next = new Set(item.hidden);
                          if (next.has(quote.id)) next.delete(quote.id);
                          else next.add(quote.id);
                          return { ...item, hidden: next };
                        }),
                      )
                    }
                  >
                    {hidden ? "Show this quotation" : "Hide this quotation"}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
