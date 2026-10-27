"use client";

import { useState } from "react";

type Option = { id: string; label: string; votes: number };

export function PollCard({
  bookId,
  question,
  options,
  yourVote,
}: {
  bookId: string;
  question: string;
  options: Option[];
  yourVote: string | null;
}) {
  const [vote, setVote] = useState(yourVote);
  const [counts, setCounts] = useState(options);
  const total = counts.reduce((sum, option) => sum + option.votes, 0) || 1;
  async function choose(id: string) {
    if (vote) return;
    const response = await fetch(`/api/books/${bookId}/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optionId: id }),
    });
    if (!response.ok) return;
    setVote(id);
    setCounts((current) => current.map((option) => (option.id === id ? { ...option, votes: option.votes + 1 } : option)));
  }
  return (
    <section className="wrap section rv in">
      <div className="card poll" id="poll">
        <span className="label red">Next book</span>
        <div className="section__head">
          <h2>Vote for book 2</h2>
        </div>
        {counts.map((option) => (
          <div key={option.id}>
            <button className={`poll__opt${vote === option.id ? " mine" : ""}`} type="button" disabled={Boolean(vote)} onClick={() => void choose(option.id)}>
              <span>{option.label}</span>
            </button>
            <span className="poll__meta">
              {option.votes} {option.votes === 1 ? "vote" : "votes"}
            </span>
          </div>
        ))}
        <p className="sr">{question || "Next book"} {total}</p>
      </div>
    </section>
  );
}
