"use client";

import { useState } from "react";

type Option = { id: string; label: string; votes: number };

export function PollCard({
  bookId,
  question,
  options,
  yourVote,
  open = true,
}: {
  bookId: string;
  question: string;
  options: Option[];
  yourVote: string | null;
  /** Set false to show the poll read-only. Votes are open by default, before and after release. */
  open?: boolean;
}) {
  const [vote, setVote] = useState(yourVote);
  const [counts, setCounts] = useState(options);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const total = counts.reduce((sum, option) => sum + option.votes, 0);
  const top = Math.max(0, ...counts.map((option) => option.votes));

  async function choose(id: string) {
    if (vote || busy || !open) return;
    setBusy(id);
    setError(null);
    try {
      const response = await fetch(`/api/books/${bookId}/poll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionId: id }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "That vote didn't go through. Try again.");
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { options?: Option[]; yourVote?: string };
      setVote(body.yourVote ?? id);
      if (body.options?.length) setCounts(body.options);
      else setCounts((current) => current.map((option) => (option.id === id ? { ...option, votes: option.votes + 1 } : option)));
    } catch {
      setError("That vote didn't go through. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="wrap section">
      <div className="vote" id="poll" data-testid="poll">
        <header className="vote__head">
          <div>
            <span className="label red">Next book</span>
            <h2>Vote for the next book</h2>
            {question ? <p className="vote__q">{question}</p> : null}
          </div>
          <span className="vote__total" data-testid="poll-total">
            <b>{total}</b> {total === 1 ? "vote" : "votes"}
          </span>
        </header>
        <ul className="vote__list">
          {counts.map((option) => {
            const share = total ? Math.round((option.votes / total) * 100) : 0;
            const mine = vote === option.id;
            const leading = total > 0 && option.votes === top;
            return (
              <li key={option.id}>
                <button
                  className={`vote__row${mine ? " mine" : ""}${vote || !open ? " done" : ""}${leading ? " lead" : ""}`}
                  type="button"
                  disabled={Boolean(vote) || Boolean(busy) || !open}
                  aria-pressed={mine}
                  onClick={() => void choose(option.id)}
                  data-testid="poll-option"
                >
                  <span className="vote__bar" style={{ width: `${share}%` }} aria-hidden="true" />
                  <span className="vote__label">{option.label}</span>
                  <span className="vote__side">
                    <span className="vote__count">
                      <b>{option.votes}</b> {option.votes === 1 ? "vote" : "votes"}
                      {total ? <em> · {share}%</em> : null}
                    </span>
                    {mine ? (
                      <span className="vote__chip vote__chip--mine">✓ Your vote</span>
                    ) : vote || !open ? null : (
                      <span className="vote__chip">{busy === option.id ? "…" : "Vote"}</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="vote__foot">{error ??
            (vote
              ? "Thanks. Your vote is in."
              : open
                ? "One vote per person. The top question becomes the next book."
                : "Voting opens when this book is released. The top question becomes the next book.")}</p>
      </div>
    </section>
  );
}
