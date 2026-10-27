"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const TYPES = [
  { id: "SOLO", title: "Solo", copy: "One person, over time. A memoir or a journal, in your voice only." },
  { id: "INVITED", title: "Invited", copy: "A private link. Family, a team, a class. Only people with it can speak." },
  { id: "OPEN", title: "Open", copy: "Anyone with the link. A public page and a live globe of contributors." },
  { id: "FAMOUS", title: "Famous voices", copy: "Public quotations you paste, each with a source link. No cloned voices." },
];

const VIBES = [
  { id: "ember", color: "#e5383b" },
  { id: "night", color: "#7aa2ff" },
  { id: "tide", color: "#2ec4b6" },
  { id: "gold", color: "#e6b325" },
  { id: "paper", color: "#d7c4b0" },
];

export function CreateBookForm({ suggestion = "" }: { suggestion?: string }) {
  const router = useRouter();
  const [type, setType] = useState("OPEN");
  const [vibe, setVibe] = useState("ember");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    const response = await fetch("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.get("title"),
        question: form.get("question"),
        type,
        coverVibe: vibe,
        closesAt: form.get("closesAt") ? new Date(String(form.get("closesAt"))).toISOString() : null,
      }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(data.error ?? "The book was not created.");
      return;
    }
    router.push(`/studio/${data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit}>
      <fieldset className="field">
        <span>What kind of book</span>
        <div className="choice">
          {TYPES.map((item) => (
            <label key={item.id} className={type === item.id ? "on" : ""}>
              <input
                type="radio"
                name="type"
                aria-label={item.title}
                value={item.id}
                checked={type === item.id}
                onChange={() => setType(item.id)}
                className="sr"
              />
              <b>{item.title}</b>
              <span>{item.copy}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {type === "FAMOUS" ? (
        <p className="fine">
          Famous voices are public, sourced quotations only. Paste the words and a link to where they were published. This book will never generate a fake quote or a synthetic voice.
        </p>
      ) : null}
      <label className="field" htmlFor="title">
        <span>Title</span>
        <input id="title" name="title" className="input" required minLength={2} maxLength={80} placeholder="Night shift notes" />
      </label>
      <label className="field" htmlFor="question">
        <span>Question or topic</span>
        <textarea id="question" name="question" className="ta" required minLength={8} maxLength={240} placeholder={suggestion || "What keeps you awake?"} defaultValue={suggestion} />
        {suggestion ? <p className="hint">Suggested from the winning vote on one of your books.</p> : null}
      </label>
      <div className="field">
        <span>Cover</span>
        <div className="vibe">
          {VIBES.map((item) => (
            <button key={item.id} type="button" aria-label={item.id} className={vibe === item.id ? "on" : ""} onClick={() => setVibe(item.id)} style={{ background: item.color }} />
          ))}
        </div>
      </div>
      <label className="field" htmlFor="closesAt">
        <span>Voices close</span>
        <input id="closesAt" name="closesAt" className="input" type="datetime-local" />
        <p className="hint">Open and invited books close in seven days if you leave this blank. Solo and famous books can stay open.</p>
      </label>
      {error ? <p className="err">{error}</p> : null}
      <button className="btn btn--red btn--big btn--block" type="submit" disabled={busy}>
        {busy ? "Creating…" : "Create the book"}
      </button>
    </form>
  );
}
