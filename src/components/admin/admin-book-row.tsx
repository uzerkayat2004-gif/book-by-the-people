"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Row = {
  id: string;
  slug: string;
  title: string;
  question: string;
  type: string;
  status: string;
  owner: string;
  voices: number;
  featured: boolean;
  unlisted: boolean;
  canFeature: boolean;
};

const STATUS: Record<string, string> = { COLLECTING: "Taking voices", CLOSED: "Closed", GENERATING: "Writing", REVIEW: "Review", PUBLISHED: "Released", DRAFT: "Draft" };

export function AdminBookRow({ book }: { book: Row }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function call(url: string, init: RequestInit) {
    setBusy(true);
    setNote(null);
    const response = await fetch(url, init);
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!response.ok) setNote(data.error ?? "That did not work.");
    else router.refresh();
  }
  return (
    <li className="adminrow" data-testid="admin-row">
      <div className="adminrow__main">
        <Link className="adminrow__t" href={`/b/${book.slug}`}>
          {book.title}
        </Link>
        <span className="adminrow__q">{book.question}</span>
        <span className="adminrow__meta">
          by {book.owner} · {STATUS[book.status] ?? book.status} · {book.voices} {book.voices === 1 ? "voice" : "voices"}
          {book.unlisted ? " · unlisted" : ""}
          {book.featured ? <em> · on the home page</em> : null}
        </span>
        {note ? <span className="adminrow__err">{note}</span> : null}
      </div>
      <div className="adminrow__acts">
        {book.featured ? (
          <button
            className="btn btn--ghost btn--sm"
            type="button"
            disabled={busy}
            onClick={() => void call(`/api/books/${book.id}/feature`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ featured: false }) })}
          >
            Unfeature
          </button>
        ) : book.canFeature ? (
          <button
            className="btn btn--red btn--sm"
            type="button"
            disabled={busy}
            onClick={() => void call(`/api/books/${book.id}/feature`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ featured: true }) })}
          >
            Feature
          </button>
        ) : null}
        {confirm ? (
          <>
            <button className="btn btn--sm adminrow__del" type="button" disabled={busy} onClick={() => void call(`/api/books/${book.id}`, { method: "DELETE" })}>
              Delete for good
            </button>
            <button className="btn btn--ghost btn--sm" type="button" onClick={() => setConfirm(false)}>
              Keep
            </button>
          </>
        ) : (
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => setConfirm(true)}>
            Delete
          </button>
        )}
      </div>
    </li>
  );
}
