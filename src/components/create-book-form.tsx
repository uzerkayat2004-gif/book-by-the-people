"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BookCover } from "@/components/book-cover";
import { SPEAK_LANGUAGES } from "@/lib/speak-languages";

const MODES = [
  { id: "SOLO", title: "Solo", copy: "Only you speak, over days or years. A memoir in your own voice." },
  { id: "INVITED", title: "Invited", copy: "A private link for family, a team or a class." },
  { id: "OPEN", title: "Open", copy: "Anyone with the link. A public page with a live globe." },
  { id: "FAMOUS", title: "Famous", copy: "Real public quotes only, each with its source link and date." },
];

const TOPICS = [
  "Is AI making you smarter or lazier?",
  "What did a stranger teach you?",
  "What does your city sound like after midnight?",
  "What would you tell your younger self?",
];

function inDays(days: number) {
  const date = new Date(Date.now() + days * 86_400_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: "18:00",
  };
}

export function CreateBookForm({ suggestion = "" }: { suggestion?: string }) {
  const router = useRouter();
  const start = useMemo(() => inDays(7), []);
  const [question, setQuestion] = useState(suggestion);
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState("OPEN");
  const [language, setLanguage] = useState("en");
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [limit, setLimit] = useState(3);
  const [aiKey, setAiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const closesAt = date ? new Date(`${date}T${time || "18:00"}`).toISOString() : null;
    const response = await fetch("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim() || question.trim().replace(/\?$/, "").slice(0, 60),
        question,
        type: mode,
        coverVibe: "ember",
        closesAt,
        language,
        voiceLimitPerDay: limit,
        aiKey: aiKey.trim() || undefined,
      }),
    });
    const data = (await response.json().catch(() => ({}))) as { slug?: string; error?: string };
    setBusy(false);
    if (!response.ok || !data.slug) {
      setError(data.error ?? "The book was not created.");
      return;
    }
    router.push(`/studio/${data.slug}?tab=settings&new=1`);
    router.refresh();
  }

  const shownTitle = title.trim() || "Book by the People";
  const shownQuestion = question.trim() || "Your question goes here?";

  return (
    <form className="newbook" onSubmit={onSubmit}>
      <div className="newbook__form">
        <section className="setcard">
          <div className="setcard__head">
            <h2>
              <span className="nb">1</span> The topic
            </h2>
          </div>
          <label className="field" htmlFor="question">
            <span>
              The question <em>— on the cover and everywhere</em>
            </span>
            <textarea
              id="question"
              name="question"
              className="ta"
              required
              minLength={8}
              maxLength={240}
              placeholder="What keeps you awake?"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
            />
          </label>
          <div className="topicchips" aria-label="Ideas">
            {TOPICS.map((topic) => (
              <button key={topic} type="button" className="chip" onClick={() => setQuestion(topic)}>
                {topic}
              </button>
            ))}
          </div>
          {suggestion ? <p className="hint">Suggested by the winning poll answer on one of your books.</p> : null}
          <label className="field" htmlFor="title">
            <span>
              Title <em>— optional, big on the cover</em>
            </span>
            <input
              id="title"
              name="title"
              className="input"
              maxLength={80}
              placeholder="Book by the People"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
        </section>

        <section className="setcard">
          <div className="setcard__head">
            <h2>
              <span className="nb">2</span> Who speaks
            </h2>
          </div>
          <div className="modes" role="radiogroup" aria-label="Mode">
            {MODES.map((item) => (
              <label key={item.id} className={`mode${mode === item.id ? " on" : ""}`}>
                <input
                  type="radio"
                  name="mode"
                  aria-label={item.title}
                  value={item.id}
                  checked={mode === item.id}
                  onChange={() => {
                    setMode(item.id);
                    if (item.id === "SOLO") setLimit(20);
                    else if (limit === 20) setLimit(3);
                  }}
                  className="sr"
                />
                <b>{item.title}</b>
                <span>{item.copy}</span>
              </label>
            ))}
          </div>
          {mode === "FAMOUS" ? (
            <p className="hint famous">
              Famous books use real, public quotes only. Every line keeps its source link and date. Nothing is generated and no voice is cloned.
            </p>
          ) : null}
        </section>

        <section className="setcard">
          <div className="setcard__head">
            <h2>
              <span className="nb">3</span> Language and release
            </h2>
          </div>
          <div className="newbook__row">
            <label className="field" htmlFor="language">
              <span>Main language</span>
              <select id="language" className="input" value={language} onChange={(event) => setLanguage(event.target.value)}>
                {SPEAK_LANGUAGES.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" htmlFor="limit">
              <span>Voices per person a day</span>
              <input
                id="limit"
                className="input"
                type="number"
                min={1}
                max={50}
                value={limit}
                onChange={(event) => setLimit(Math.max(1, Math.min(50, Number(event.target.value) || 1)))}
              />
            </label>
          </div>
          <div className="newbook__row">
            <label className="field" htmlFor="date">
              <span>Release date</span>
              <input id="date" className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
            <label className="field" htmlFor="time">
              <span>Time</span>
              <input id="time" className="input" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
            </label>
          </div>
          <p className="hint">Voices close at this moment and the book is written. People can speak in any of 30 languages.</p>
        </section>

        <section className="setcard">
          <div className="setcard__head">
            <h2>
              <span className="nb">4</span> Your AI key <em className="opt">optional</em>
            </h2>
          </div>
          <label className="field" htmlFor="aiKey">
            <span>
              Meta AI key <em>— encrypted on the server, never shown again</em>
            </span>
            <input
              id="aiKey"
              className="input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste a key, or add it later in Book settings"
              value={aiKey}
              onChange={(event) => setAiKey(event.target.value)}
            />
          </label>
          <p className="hint">The app is free. AI runs on your key, with one spend cap per book.</p>
        </section>

        {error ? <p className="err">{error}</p> : null}
        <button className="btn btn--red btn--big btn--block" type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create the book"}
        </button>
      </div>
      <aside className="newbook__cover" aria-label="Cover preview">
        <p className="label">Cover preview</p>
        <div className="newbook__book">
          <BookCover question={shownQuestion} people={0} countries={0} names={[]} title={shownTitle} />
        </div>
        <p className="muted">
          {MODES.find((item) => item.id === mode)?.title} · {SPEAK_LANGUAGES.find((item) => item.code === language)?.label.split(" ").pop()} ·{" "}
          {date ? new Date(`${date}T${time || "18:00"}`).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "no date"}
        </p>
      </aside>
    </form>
  );
}
