"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { flagEmoji } from "@/lib/countries";

type VoiceRow = {
  id: string;
  name: string;
  language: string;
  countryCode: string | null;
  originalText: string;
  englishText: string;
  translated: boolean;
  status: string;
  hidden: boolean;
  rejectReason: string | null;
  kind: string;
  sourceUrl: string | null;
  hasAudio: boolean;
};

type DraftRow = { id: string; version: number; provider: string; model: string; note: string; current: boolean };

const PIPE = ["🎙 Transcribe", "🎯 On topic", "🙋 Real person", "📋 Copy-paste", "🪪 Impersonation", "⚖️ Decide", "🧩 Group"];

export function StudioDesk({
  book,
  voices,
  drafts,
  pollText,
  canChangeType,
  spend,
  chapters,
  themes,
}: {
  book: {
    id: string;
    slug: string;
    title: string;
    question: string;
    type: string;
    status: string;
    coverVibe: string;
    closesAt: string | null;
    pollQuestion: string;
    invitePath: string;
    generationError: string | null;
    log: string[];
    paused: boolean;
  };
  voices: VoiceRow[];
  drafts: DraftRow[];
  pollText: string;
  canChangeType: boolean;
  spend: { usd: string; cap: string | null };
  chapters: string[];
  themes: { label: string; count: number }[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"ai" | "make" | "release">("ai");
  const [groupBy, setGroupBy] = useState<"theme" | "country">("theme");
  const [error, setError] = useState<string | null>(book.generationError);
  const [log, setLog] = useState<string[]>(book.log);
  const [busy, setBusy] = useState<string | null>(null);
  const ready = voices.filter((voice) => voice.status === "READY" && !voice.hidden);
  const failed = voices.filter((voice) => voice.status === "FAILED");
  const hidden = voices.filter((voice) => voice.hidden || voice.status === "REJECTED");
  const needsClose = book.type === "OPEN" || book.type === "INVITED";
  const closedEnough = !needsClose || book.status === "CLOSED" || book.status === "REVIEW" || book.status === "PUBLISHED";

  async function post(url: string, body?: unknown) {
    const response = await fetch(url, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? "That did not work.");
    return data;
  }

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  const groups = new Map<string, number>();
  for (const voice of ready) {
    const key = voice.countryCode || voice.language || "Unplaced";
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const maxGroup = Math.max(1, ...groups.values());

  return (
    <main className="page admin">
      <div className="wrap admin4">
        <h2 className="booktag">{book.title}</h2>
        <p className="label">
          {book.type} · {book.status}
        </p>
        <div className="ownerbar">
          <div className="otabs">
            {(
              [
                ["ai", "AI at work"],
                ["make", "Make the book"],
                ["release", "Release"],
              ] as const
            ).map(([key, label], index) => (
              <a
                key={key}
                href={`#${key}`}
                className={tab === key ? "on" : ""}
                onClick={(event) => {
                  event.preventDefault();
                  setTab(key);
                }}
              >
                <b>{index + 1}</b>
                {label}
              </a>
            ))}
          </div>
          <form action="/api/auth/sign-out" method="post">
            <button className="ownerout" type="submit">
              Sign out
            </button>
          </form>
        </div>

        {book.paused ? <p className="err">Voices are paused right now. New recordings wait until the spend cap is raised.</p> : null}
        {error ? <p className="err">{error}</p> : null}

        {tab === "ai" ? (
          <>
            <div className="ai__head">
              <div>
                <h1>AI at work</h1>
                <p className="lead" style={{ margin: "10px 0 0" }}>
                  You only see the unsure ones.
                </p>
              </div>
              <span className="running">
                <i />
                {book.status === "GENERATING" ? "Writing the book" : "Running · every 5 min"}
              </span>
            </div>
            <div className="aitiles">
              <div className="card">
                <b>{voices.length.toLocaleString("en-US")}</b>
                <span>heard</span>
              </div>
              <div className="card ok">
                <b>{ready.length.toLocaleString("en-US")}</b>
                <span>approved</span>
              </div>
              <div className="card eye">
                <b>{failed.length.toLocaleString("en-US")}</b>
                <span>need you</span>
              </div>
              <div className="card no">
                <b>{hidden.length.toLocaleString("en-US")}</b>
                <span>not used</span>
              </div>
            </div>
            <div className="pipe" aria-label="What happens to every voice">
              {PIPE.map((step, index) => (
                <Fragment key={step}>
                  {index ? <i /> : null}
                  <span style={{ ["--i" as string]: index }}>{step}</span>
                </Fragment>
              ))}
            </div>
            <div className="ai__grid">
              <section>
                <div className="section__head">
                  <h2>Live</h2>
                  <span className="live">
                    <i />
                  </span>
                </div>
                <div className="feed">
                  {voices.length === 0 ? (
                    <div className="card bl">
                      <p className="muted" style={{ fontFamily: "var(--sans)", margin: 0 }}>
                        No voices yet. Share the link. Nothing here is deleted on its own.
                      </p>
                    </div>
                  ) : (
                    [...voices].reverse().slice(0, 6).map((voice) => <VoiceCard key={voice.id} voice={voice} run={run} />)
                  )}
                </div>
              </section>
              <section>
                <div className="section__head">
                  <h2>Matching voices</h2>
                  <span className="label">{groupBy === "theme" ? "grouped by AI" : "grouped by country"}</span>
                </div>
                <div className="cardfmt" role="tablist" aria-label="How voices are grouped" style={{ marginTop: 0 }}>
                  <button type="button" className={groupBy === "theme" ? "on" : ""} onClick={() => setGroupBy("theme")}>
                    Same views
                  </button>
                  <button type="button" className={groupBy === "country" ? "on" : ""} onClick={() => setGroupBy("country")}>
                    Country
                  </button>
                </div>
                <div className="card groups">
                  {groupBy === "theme" ? (
                    themes.length === 0 ? (
                      <p className="muted" style={{ fontFamily: "var(--sans)", margin: "8px 0" }}>
                        Groups appear after the first voice is ready.
                      </p>
                    ) : (
                      themes.map((group) => (
                        <div className="gr" key={group.label}>
                          <div className="gr__t">{group.label}</div>
                          <div className="gr__bar">
                            <i style={{ width: `${(group.count / Math.max(1, ...themes.map((item) => item.count))) * 100}%` }} />
                          </div>
                          <div className="gr__n">
                            said by <b>{group.count.toLocaleString("en-US")}</b> {group.count === 1 ? "person" : "people"}
                          </div>
                        </div>
                      ))
                    )
                  ) : groups.size === 0 ? (
                    <p className="muted" style={{ fontFamily: "var(--sans)", margin: "8px 0" }}>
                      Groups appear after the first voice is ready.
                    </p>
                  ) : (
                    [...groups.entries()].map(([name, count]) => (
                      <div className="gr" key={name}>
                        <div className="gr__t">{name}</div>
                        <div className="gr__bar">
                          <i style={{ width: `${(count / maxGroup) * 100}%` }} />
                        </div>
                        <div className="gr__n">
                          said by <b>{count}</b> {count === 1 ? "person" : "people"}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                {failed.length ? (
                  <>
                    <div className="section__head" style={{ marginTop: 26 }}>
                      <h2>Needs your eye</h2>
                      <span className="label">{failed.length}</span>
                    </div>
                    {failed.map((voice) => (
                      <div className="card bl" key={voice.id}>
                        <div className="bl__why">{voice.rejectReason || "The transcript failed."}</div>
                        <p>“{voice.originalText || "No words yet."}”</p>
                        <div className="bl__act">
                          <button className="btn btn--sm" type="button" onClick={() => run(voice.id, () => post(`/api/voices/${voice.id}/retry`).then(() => undefined))}>
                            Retry
                          </button>
                        </div>
                      </div>
                    ))}
                  </>
                ) : null}
                {book.type === "FAMOUS" ? <QuoteForm bookId={book.id} onDone={() => router.refresh()} /> : null}
                <div style={{ marginTop: 26 }}>
                  <Spend spend={spend} />
                </div>
                {log.length ? (
                  <ul className="fine">
                    {log.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            </div>
          </>
        ) : null}

        {tab === "make" ? (
          <>
            <div className="ai__head">
              <div>
                <h1>Make the book</h1>
                <p className="lead" style={{ margin: "10px 0 0" }}>
                  {chapters.length || "—"} chapters · quotes stay verbatim
                </p>
              </div>
            </div>
            <div className="admin4__grid">
              <div>
                <div className="prog-steps">
                  {[
                    ["Freeze", "stop new voices"],
                    ["Group", `${voices.length.toLocaleString("en-US")} voices`],
                    ["Summarise", "similar views together"],
                    ["Outline", chapters.length ? `${chapters.length} chapters` : "chapters follow the voices"],
                    ["Write", "real quotes only"],
                    ["Credit", `${ready.length.toLocaleString("en-US")} people placed`],
                  ].map(([step, detail]) => (
                    <div className={`ps${drafts.length ? " ok" : ""}`} key={step}>
                      <i>{drafts.length ? "✓" : ""}</i>
                      <span>
                        <b>{step}</b> · <span className="muted">{detail}</span>
                      </span>
                      <small>{drafts.length ? "done" : ""}</small>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                {chapters.length ? (
                  <>
                    <div className="section__head">
                      <h2>Preview</h2>
                      <span className="label">from the current draft</span>
                    </div>
                    <div className="chlist">
                      {chapters.map((title, index) => (
                        <div className="chrow" key={title}>
                          <span className="chrow__n">{index + 1}</span>
                          <span className="chrow__t">{title}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="card bl">
                    <p className="muted" style={{ fontFamily: "var(--sans)", margin: 0 }}>
                      The chapter preview appears here when the book is made.
                    </p>
                  </div>
                )}
                {drafts[0] ? (
                  <p className="hint">
                    Current draft v{drafts[0].version} · {drafts[0].provider} {drafts[0].model}
                  </p>
                ) : null}
              </div>
            </div>
          </>
        ) : null}

        {tab === "release" ? (
          <>
            <div className="ai__head">
              <div>
                <h1>Release</h1>
              </div>
            </div>
            <div className="card upl">
              <div>
                <b>Publish</b>
                <div className="muted" style={{ fontSize: 14 }}>
                  {book.status === "PUBLISHED" ? "The book is out." : "It opens for everyone. Drafts stay, so you can roll back."}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 22 }}>
              <Spend spend={spend} />
            </div>
            <SettingsForm book={book} pollText={pollText} canChangeType={canChangeType} onDone={() => router.refresh()} />
            <h2 style={{ marginTop: 28 }}>Drafts</h2>
            {drafts.length === 0 ? <p className="hint">No draft yet.</p> : null}
            <div className="chlist">
              {drafts.map((draft) => (
                <div className="chrow" key={draft.id}>
                  <span className="chrow__n">v{draft.version}</span>
                  <span className="chrow__t">
                    {draft.provider} {draft.model}
                    {draft.current ? <small>current</small> : null}
                  </span>
                  {draft.current ? null : (
                    <button className="link" type="button" onClick={() => run(draft.id, () => post(`/api/books/${book.id}/rollback`, { draftId: draft.id }).then(() => undefined))}>
                      Roll back to this
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : null}

        <div className="studio-actions">
          {needsClose && book.status === "COLLECTING" ? (
            <button className="btn btn--ghost btn--sm" type="button" disabled={busy !== null} onClick={() => run("close", () => post(`/api/books/${book.id}/close`).then(() => undefined))}>
              Close voices
            </button>
          ) : null}
          <button
            className="btn btn--red btn--sm"
            type="button"
            disabled={busy !== null || ready.length === 0 || !closedEnough}
            onClick={() =>
              run("make", async () => {
                const data = await post(`/api/books/${book.id}/generate`);
                setLog(data.log ?? []);
              })
            }
          >
            {busy === "make" ? "Writing the book…" : "Make the book"}
          </button>
          <button className="btn btn--ghost btn--sm" type="button" disabled={busy !== null || ready.length === 0} onClick={() => run("local", () => post(`/api/books/${book.id}/generate?engine=local`).then((data) => setLog(data.log ?? [])))}>
            Assemble locally
          </button>
          <button className="btn btn--sm" type="button" disabled={busy !== null || drafts.length === 0} onClick={() => run("publish", () => post(`/api/books/${book.id}/publish`).then(() => undefined))}>
            Publish
          </button>
          <a className="link" href={book.invitePath}>
            {book.type === "INVITED" ? "Invite link" : "Add a voice"}
          </a>
          {drafts.length > 0 ? (
            <a className="link" href={`/studio/${book.id}/editor`}>
              Edit the draft
            </a>
          ) : null}
          {book.status === "PUBLISHED" ? (
            <a className="link" href={`/b/${book.slug}/read`}>
              Read
            </a>
          ) : null}
          <a className="link" href={`/b/${book.slug}`}>
            Public page
          </a>
        </div>
      </div>
    </main>
  );
}

function Spend({ spend }: { spend: { usd: string; cap: string | null } }) {
  return (
    <div className="card spend">
      <div className="spend__top">
        <div>
          <div className="label">AI spend</div>
          <b>{spend.usd}</b>
          {spend.cap ? <span className="muted"> of {spend.cap}</span> : <span className="muted"> no cap set</span>}
        </div>
        <div className="modelchip">
          Mock
          <small>until a key is set</small>
        </div>
      </div>
      <p className="fine" style={{ margin: "12px 0 0" }}>
        Voices already stored are kept. Making a new draft does not delete the old one.
      </p>
    </div>
  );
}

function VoiceCard({ voice, run }: { voice: VoiceRow; run: (label: string, action: () => Promise<void>) => Promise<void> }) {
  const passed = voice.status === "READY" && !voice.hidden;
  return (
    <div className={`fi ${passed ? "is-ok" : voice.status === "FAILED" ? "is-eye" : voice.hidden ? "is-no" : ""}`}>
      <div className="fi__top">
        <b>
          {voice.name} {voice.countryCode ? flagEmoji(voice.countryCode) : ""}
        </b>
        <span className="fi__t">{voice.status}</span>
      </div>
      <p>“{voice.originalText || voice.englishText || "Waiting on the transcript."}”</p>
      {voice.translated && voice.englishText ? <p className="hint">{voice.englishText}</p> : null}
      <div className="cks">
        <span className={`ck ${voice.originalText ? "pass" : "run"}`}>{voice.originalText ? "✓" : ""} Transcribe</span>
        <span className={`ck ${passed ? "pass" : voice.hidden ? "flag" : ""}`}>{passed ? "✓" : ""} Decide</span>
      </div>
      <div className="fi__res">
        {passed ? <span className="res ok">Approved</span> : voice.hidden ? <span className="res no">Not used</span> : <span className="res run">{voice.status}</span>}
        {voice.sourceUrl ? (
          <a className="link" href={voice.sourceUrl} target="_blank" rel="noreferrer">
            Source
          </a>
        ) : null}
        <button
          className="link"
          type="button"
          onClick={() =>
            run(voice.id, () =>
              fetch(`/api/voices/${voice.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ hidden: !voice.hidden }),
              }).then(() => undefined),
            )
          }
        >
          {voice.hidden ? "Show" : "Hide"}
        </button>
        <button
          className="link"
          type="button"
          onClick={() => {
            if (!window.confirm("Delete this voice and its audio?")) return;
            void run(voice.id, () => fetch(`/api/voices/${voice.id}`, { method: "DELETE" }).then(() => undefined));
          }}
        >
          Delete
        </button>
      </div>
      {voice.hasAudio ? <audio controls src={`/api/audio/${voice.id}`} style={{ width: "100%", marginTop: 8 }} /> : null}
    </div>
  );
}

function QuoteForm({ bookId, onDone }: { bookId: string; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const response = await fetch(`/api/books/${bookId}/quotes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        speaker: data.get("speaker"),
        text: data.get("text"),
        sourceUrl: data.get("sourceUrl"),
        sourceTitle: data.get("sourceTitle"),
        language: "en",
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error ?? "The quotation was not added.");
      return;
    }
    form.reset();
    setError(null);
    onDone();
  }
  return (
    <form onSubmit={onSubmit} className="card bl" style={{ marginTop: 22 }}>
      <h2>Famous replies</h2>
      <p className="muted" style={{ fontFamily: "var(--sans)", fontSize: 14.5 }}>
        Paste a real public quotation and the page it was published on. Typed names never get a play button.
      </p>
      <input className="input" name="speaker" aria-label="Speaker" placeholder="Who said it" required style={{ marginTop: 10 }} />
      <textarea className="ta" name="text" aria-label="Quotation" placeholder="The quotation, verbatim" required style={{ marginTop: 10 }} />
      <input className="input" name="sourceUrl" aria-label="Source URL" placeholder="https://source.example/article" required style={{ marginTop: 10 }} />
      <input className="input" name="sourceTitle" aria-label="Source title" placeholder="Source title" style={{ marginTop: 10 }} />
      {error ? <p className="err">{error}</p> : null}
      <button className="btn btn--sm" type="submit" style={{ marginTop: 12 }}>
        Add quote
      </button>
    </form>
  );
}

function SettingsForm({
  book,
  pollText,
  canChangeType,
  onDone,
}: {
  book: { id: string; title: string; question: string; type: string; coverVibe: string; closesAt: string | null; pollQuestion: string };
  pollText: string;
  canChangeType: boolean;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const localClose = book.closesAt ? toLocalInput(book.closesAt) : "";
  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const closes = String(form.get("closesAt") ?? "");
    const response = await fetch(`/api/books/${book.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.get("title"),
        question: form.get("question"),
        type: form.get("type"),
        coverVibe: form.get("coverVibe"),
        closesAt: closes ? new Date(closes).toISOString() : null,
        pollQuestion: form.get("pollQuestion"),
        pollOptions: String(form.get("pollOptions") ?? "")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "Settings were not saved.");
      return;
    }
    setError(null);
    onDone();
  }
  return (
    <form onSubmit={onSubmit} className="card bl" style={{ marginTop: 22 }}>
      <h2>Settings</h2>
      <label className="field">
        <span>Title</span>
        <input className="input" name="title" defaultValue={book.title} />
      </label>
      <label className="field">
        <span>Question</span>
        <textarea className="ta" name="question" defaultValue={book.question} />
      </label>
      <label className="field">
        <span>Type</span>
        <select className="input" name="type" defaultValue={book.type} disabled={!canChangeType}>
          {["SOLO", "INVITED", "OPEN", "FAMOUS"].map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Cover</span>
        <select className="input" name="coverVibe" defaultValue={book.coverVibe}>
          {["ember", "night", "tide", "gold", "paper"].map((vibe) => (
            <option key={vibe} value={vibe}>
              {vibe}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Close time</span>
        <input className="input" name="closesAt" type="datetime-local" defaultValue={localClose} />
      </label>
      <label className="field">
        <span>Poll question</span>
        <input className="input" name="pollQuestion" defaultValue={book.pollQuestion} />
      </label>
      <label className="field">
        <span>Poll choices, one per line</span>
        <textarea className="ta" name="pollOptions" defaultValue={pollText} />
      </label>
      {error ? <p className="err">{error}</p> : null}
      <button className="btn btn--sm" type="submit">
        Save settings
      </button>
    </form>
  );
}

function toLocalInput(iso: string) {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
