"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookCover } from "@/components/book-cover";
import { IconShield } from "@/components/icons";
import { releaseLabel } from "@/lib/stage";

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
  sourceDate: string;
  hasAudio: boolean;
  decision: string;
  themeLabel: string;
  pipelineStep: string;
};

type DraftRow = { id: string; version: number; provider: string; model: string; note: string; current: boolean };

const TABS = [
  ["settings", "Book settings"],
  ["ai", "AI at work"],
  ["make", "Make the book"],
  ["release", "Release"],
] as const;

type Tab = (typeof TABS)[number][0];

const PIPE = ["🎙 Transcribe", "🌐 Translate", "🎯 On topic", "🙋 Real person", "📋 Copy-paste", "🔁 Duplicate", "🪪 Impersonation", "⚖️ Decide", "🧩 Group"];

const SAMPLE_BACKUPS = [
  "2 days ago · 0 voices",
  "4 days ago · 0 voices",
  "4 days ago · 4 voices",
  "4 days ago · 2 voices",
  "4 days ago · 2 voices",
  "4 days ago · 0 voices",
];

export function StudioDesk({
  book,
  voices,
  drafts,
  initialTab = "settings",
  pollOptions,
  canChangeType,
  spend,
  chapters,
  themes,
  books = [],
  backups = [],
  media,
  aiPaused = false,
  showPoll = true,
  bookNumber = 1,
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
  initialTab?: Tab;
  pollOptions: { label: string; votes: number }[];
  canChangeType: boolean;
  spend: { usd: string; cap: string | null };
  chapters: string[];
  themes: { label: string; count: number }[];
  books?: { id: string; slug: string; title: string }[];
  backups?: { label: string; voices: number; note: string }[];
  media: { audioHref: string | null; videoHref: string | null; audioBytes: number; videoBytes: number; audioName: string; videoName: string };
  aiPaused?: boolean;
  showPoll?: boolean;
  bookNumber?: number;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);
  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetch(`/api/books/${book.id}/tick`, { method: "POST" }).then((response) => {
        if (response.ok) router.refresh();
      });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [book.id, router]);
  const [error, setError] = useState<string | null>(book.generationError);
  const [busy, setBusy] = useState<string | null>(null);
  const [debug, setDebug] = useState(false);
  const ready = voices.filter((voice) => voice.status === "READY" && !voice.hidden && voice.decision !== "not_used" && voice.decision !== "hidden");
  const needsYou = voices.filter((voice) => voice.decision === "needs_you" || voice.status === "NEEDS_YOU" || voice.status === "FAILED");
  const notUsed = voices.filter((voice) => voice.decision === "not_used" || voice.status === "NOT_USED" || voice.status === "REJECTED");
  const hidden = voices.filter((voice) => voice.hidden || voice.decision === "hidden" || voice.status === "HIDDEN");
  const grouped = new Map<string, number>();
  for (const voice of voices) {
    if (!voice.themeLabel || voice.hidden || voice.decision === "not_used" || voice.decision === "hidden") continue;
    grouped.set(voice.themeLabel, (grouped.get(voice.themeLabel) ?? 0) + 1);
  }
  const groups = grouped.size ? [...grouped.entries()].map(([label, count]) => ({ label, count })) : themes;
  const needsClose = book.type === "OPEN" || book.type === "INVITED";
  const closedEnough = !needsClose || ["CLOSED", "REVIEW", "PUBLISHED"].includes(book.status);
  const accepting = book.status === "COLLECTING";
  const when = book.closesAt ? releaseLabel(new Date(book.closesAt)) : "Oct 26 · 12:00 AM IST";

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

  const makeButton = (
    <button
      className="btn btn--red btn--big btn--block"
      type="button"
      disabled={busy !== null}
      onClick={() =>
        run("make", async () => {
          await post(`/api/books/${book.id}/generate`);
        })
      }
    >
      {busy === "make" ? "Writing the book…" : "Make the book"}
    </button>
  );

  const publishButton = (big: boolean) => (
    <button
      className={big ? "btn btn--red btn--big btn--block" : "btn btn--sm"}
      type="button"
      disabled={busy !== null}
      onClick={() => run("publish", () => post(`/api/books/${book.id}/publish`).then(() => undefined))}
    >
      {big ? 'Publish a version from "Make the book"' : "Publish"}
    </button>
  );

  return (
    <main className="page admin">
      <div className="wrap admin4">
        <h2 className="sr">{book.title}</h2>
        <div className="ownerbar">
          <div className="otabs">
            {TABS.map(([key, label], index) => (
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
          <span className="running" title="aiTick is processing voices">
            <i />
            AI running
          </span>
          <a className="ownerout" href="/">
            <IconShield /> Sign out of studio
          </a>
          <form action="/api/auth/sign-out" method="post">
            <button className="ownerout" type="submit">
              <IconShield /> Sign out
            </button>
          </form>
        </div>
        {books.length > 1 ? (
          <div className="otabs bookswitch">
            {books.map((item) => (
              <a key={item.id} href={`/studio/${item.slug}`} className={item.id === book.id ? "on" : ""}>
                {item.title}
              </a>
            ))}
          </div>
        ) : null}
        <p className="sr">
          {book.type} · {book.status}
        </p>
        {book.paused ? <p className="err">Voices are paused right now. New recordings wait until the spend cap is raised.</p> : null}
        {error ? <p className="err">{error}</p> : null}

        {tab === "settings" ? (
          <div className="live-col">
            <h1>Book settings</h1>
            <p className="lead" style={{ margin: "8px 0 18px" }}>
              Everything about this book in one place.
            </p>
            <SettingsCards
              book={book}
              pollOptions={pollOptions}
              canChangeType={canChangeType}
              accepting={accepting}
              needsClose={needsClose}
              aiPaused={aiPaused}
              showPoll={showPoll}
              bookNumber={bookNumber}
              invitePath={book.invitePath}
              bookType={book.type}
              busy={busy}
              onClose={() => run("close", () => post(`/api/books/${book.id}/close`).then(() => undefined))}
              when={when}
              counts={{
                people: ready.length,
                countries: new Set(ready.map((voice) => voice.countryCode).filter(Boolean)).size,
              }}
              onDone={() => router.refresh()}
            />
            <p>
              <a className="link" href={book.invitePath}>
                Add a voice
              </a>
            </p>
            {book.type === "FAMOUS" ? (
              <>
                <QuoteForm bookId={book.id} onDone={() => router.refresh()} />
                {voices
                  .filter((voice) => voice.kind === "sourced_quote")
                  .map((voice) => (
                    <p key={voice.id}>
                      {voice.name}
                      {voice.sourceDate ? ` · ${voice.sourceDate}` : ""}
                      {voice.sourceUrl ? (
                        <>
                          {" "}
                          <a className="link" href={voice.sourceUrl}>
                            Source
                          </a>
                        </>
                      ) : null}
                    </p>
                  ))}
              </>
            ) : null}
          </div>
        ) : null}

        {tab === "ai" ? (
          <>
            <div className="ai__head">
              <div>
                <h1>AI at work</h1>
                <p className="lead" style={{ margin: "8px 0 0" }}>
                  You only see the unsure ones.
                </p>
              </div>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className="running">
                  <i />
                  Running · every 60 s
                </span>
                <button
                  className="btn btn--sm"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => run("tick", () => post(`/api/books/${book.id}/tick`).then(() => undefined))}
                >
                  {busy === "tick" ? "Running…" : "Run AI now"}
                </button>
              </span>
            </div>
            <div className="aitiles">
              <div className="card">
                <b>{voices.length}</b>
                <span>heard</span>
              </div>
              <div className="card ok">
                <b>{ready.length}</b>
                <span>approved</span>
              </div>
              <div className="card eye">
                <b>{needsYou.length}</b>
                <span>need you</span>
              </div>
              <div className="card no">
                <b>{notUsed.length}</b>
                <span>not used</span>
              </div>
              <div className="card">
                <b>{hidden.length}</b>
                <span>hidden</span>
              </div>
            </div>
            <div className="pipe" aria-label="What happens to every voice">
              {PIPE.map((step, index) => (
                <span key={step}>
                  {index ? <i /> : null}
                  {step}
                </span>
              ))}
            </div>
            <div className="ai__grid">
              <section>
                <div className="section__head">
                  <h2 className="label">
                    <span className="live">
                      <i />
                    </span>{" "}
                    Live
                  </h2>
                </div>
                <div className="card bl">
                  {voices.length === 0 ? (
                    <p style={{ margin: 0 }}>No voices yet.</p>
                  ) : (
                    [...voices].reverse().slice(0, 4).map((voice) => (
                      <p key={voice.id} style={{ margin: "0 0 10px" }}>
                        <b>{voice.name}</b> — {voice.pipelineStep || voice.status}
                        {voice.decision ? <span className="muted"> · {voice.decision.replace("_", " ")}</span> : null}
                      </p>
                    ))
                  )}
                </div>
              </section>
              <section>
                <div className="section__head">
                  <h2 className="label">Matching voices</h2>
                  <span className="label">Grouped by AI</span>
                </div>
                <div className="card bl">
                  {groups.length === 0 ? (
                    <p style={{ margin: 0 }}>
                      <b>Groups appear once voices are in.</b>
                    </p>
                  ) : (
                    groups.map((group) => (
                      <p key={group.label} style={{ margin: "0 0 8px" }}>
                        <b>{group.label}</b>
                        <span className="muted"> · {group.count}</span>
                      </p>
                    ))
                  )}
                </div>
                <h2 className="label" style={{ marginTop: 18 }}>
                  Needs your eye <span className="muted">{needsYou.length}</span>
                </h2>
                <div className="card bl">
                  {needsYou.length === 0
                    ? "All clear."
                    : needsYou.map((voice) => (
                        <p key={voice.id} style={{ margin: "0 0 8px" }}>
                          <b>{voice.name}</b> — {voice.rejectReason || voice.originalText || "Needs a look."}
                        </p>
                      ))}
                </div>
                <h2 className="label" style={{ marginTop: 18 }}>
                  Name checks <span className="muted">0</span>
                </h2>
                <div className="card bl">No flagged names.</div>
                <h2 className="label" style={{ marginTop: 18 }}>
                  Removed by AI <span className="muted">{hidden.length}</span>
                </h2>
                <div className="card bl">{hidden.length === 0 ? "Nothing hidden." : hidden.map((voice) => voice.name).join(", ")}</div>
                <h2 className="label" style={{ marginTop: 18 }}>
                  Famous replies from X
                </h2>
                <div className="card bl">
                  <p className="muted" style={{ fontFamily: "var(--sans)", fontSize: 14.5 }}>
                    Paste reply links. They go through the same AI checks. Only real X replies get a ✓ — typed names never do.
                  </p>
                  <textarea className="ta" placeholder="https://x.com/…/status/…" />
                  <button className="btn btn--sm" type="button" style={{ marginTop: 10 }}>
                    Import
                  </button>
                </div>
                <div style={{ marginTop: 18 }}>
                  <Spend spend={spend} />
                </div>
              </section>
            </div>
          </>
        ) : null}

        {tab === "make" ? (
          <>
            <h1>Make the book</h1>
            <p className="lead" style={{ margin: "8px 0 18px" }}>
              Chapters shaped by the voices · drafts first · nothing live until you publish
            </p>
            <div className="live-grid">
              <div>
                {["Freeze", "Plan", "Write", "Check", "Draft ready", "Publish"].map((step) => (
                  <div className="setcard" key={step} style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 14px" }}>
                    <span className="stepdot" aria-hidden />
                    <b>{step}</b>
                  </div>
                ))}
                {makeButton}
                {drafts.length > 0 ? (
                  <p style={{ marginTop: 12 }}>
                    <a className="link" href={`/studio/${book.id}/editor`}>
                      Edit the draft
                    </a>
                    {book.status === "PUBLISHED" ? (
                      <>
                        {" · "}
                        <a className="link" href={`/b/${book.slug}/read`}>
                          Read
                        </a>
                      </>
                    ) : null}
                  </p>
                ) : null}
                {drafts.length > 0 ? <div style={{ marginTop: 12 }}>{publishButton(true)}</div> : null}
                <button className="btn btn--ghost btn--block" type="button" style={{ marginTop: 8 }} disabled={busy !== null || ready.length === 0} onClick={() => run("local", () => post(`/api/books/${book.id}/generate?engine=local`).then(() => undefined))}>
                  Test run
                </button>
                <button
                  className="btn btn--ghost btn--block"
                  type="button"
                  style={{ marginTop: 8 }}
                  onClick={() => {
                    const blob = new Blob([JSON.stringify({ book, voices, drafts, chapters }, null, 2)], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = `${book.slug}-backup.json`;
                    link.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Download backup
                </button>
              </div>
              <div>
                <div className="card bl">
                  {chapters.length === 0 ? "The draft review appears here once the book is made. Nothing public changes until you publish a version." : chapters.map((title) => <p key={title}>{title}</p>)}
                </div>
                <div className="card bl" style={{ marginTop: 12 }}>
                  <div className="label">
                    Versions <span style={{ float: "right" }}>{drafts.length} total</span>
                  </div>
                  {drafts.length === 0 ? <p>No versions yet.</p> : drafts.map((draft) => <p key={draft.id}>v{draft.version} · {draft.provider}</p>)}
                </div>
                <div className="card bl" style={{ marginTop: 12 }}>
                  <div className="label">Data health <span className="muted">sample</span></div>
                  <p>
                    Voices: {voices.length} · Last backup: 2 days ago · no data lost
                  </p>
                  <button className="btn btn--sm" type="button" onClick={() => run("backup", () => post(`/api/books/${book.id}/backup`).then(() => undefined))}>
                    {busy === "backup" ? "Saving…" : "Backup now"}
                  </button>
                  {(backups.length ? backups.map((row) => `${row.label} · ${row.voices} voices`) : SAMPLE_BACKUPS).map((row, index) => (
                    <div className="setrow" key={`${row}-${index}`}>
                      <span>
                        {row}
                        {backups.length ? "" : " · sample"}
                      </span>
                      <button className="btn btn--ghost btn--sm" type="button">
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 12 }}>
                  <Spend spend={spend} />
                </div>
              </div>
            </div>
          </>
        ) : null}

        {tab === "release" ? (
          <>
            <h1>Release</h1>
            <div className="live-grid" style={{ marginTop: 16 }}>
              <div>
                <div className="card bl">
                  <b>Opens {when}</b>
                  <div className="muted">change in Book settings</div>
                </div>
                <div className="card upl" style={{ marginTop: 12 }}>
                  <div>
                    <b>1 · Copy for NotebookLM</b>
                    <div className="muted">For audio + video</div>
                  </div>
                  <button
                    className="btn btn--sm"
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(`${book.title}\n${book.question}\n${chapters.join("\n")}`)}
                  >
                    Copy
                  </button>
                </div>
                <div className="card upl" style={{ marginTop: 12 }}>
                  <div>
                    <b>2 · Audio</b>
                    <div className="muted">
                      {media.audioHref ? (
                        <>
                          ✓ {media.audioName} · {sizeLabel(media.audioBytes)}{" "}
                          <a className="link" href={media.audioHref}>
                            Play
                          </a>{" "}
                          <a className="link" href={`${media.audioHref}?download=1`}>
                            Download
                          </a>
                        </>
                      ) : (
                        <>✓ t-rex-roar.mp3 · 39 KB · sample file</>
                      )}
                    </div>
                  </div>
                  <label className="btn btn--ghost btn--sm">
                    Replace
                    <input type="file" accept="audio/*" hidden />
                  </label>
                </div>
                <div className="card upl" style={{ marginTop: 12 }}>
                  <div>
                    <b>3 · Video</b>
                    <div className="muted">
                      {media.videoHref ? (
                        <>
                          ✓ {media.videoName} · {sizeLabel(media.videoBytes)}{" "}
                          <a className="link" href={media.videoHref}>
                            Play
                          </a>{" "}
                          <a className="link" href={`${media.videoHref}?download=1`}>
                            Download
                          </a>
                        </>
                      ) : (
                        <>✓ flower.mp4 · 1.1 MB · sample file</>
                      )}
                    </div>
                  </div>
                  <label className="btn btn--ghost btn--sm">
                    Replace
                    <input type="file" accept="video/*" hidden />
                  </label>
                </div>
                <div style={{ marginTop: 16 }}>{publishButton(true)}</div>
              </div>
              <div className="relprev">
                <BookCover question={book.question} people={ready.length} countries={new Set(ready.map((voice) => voice.countryCode).filter(Boolean)).size} names={ready.map((voice) => voice.name)} />
              </div>
            </div>
          </>
        ) : null}

        <button className="label" type="button" onClick={() => setDebug((open) => !open)} style={{ marginTop: 18, background: "none" }}>
          Debug
        </button>
        {debug ? <p className="muted">API reads last 60s: 1</p> : null}
      </div>
    </main>
  );
}

function Spend({ spend }: { spend: { usd: string; cap: string | null } }) {
  const cap = spend.cap ?? "$20.00";
  return (
    <div className="card spend">
      <div className="spend__top" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div className="label">AI spend</div>
          <b style={{ fontSize: 28 }}>{spend.usd === "$0.00" ? "<$0.01" : spend.usd}</b>
          <span className="muted"> of {cap}</span>
        </div>
        <div className="modelchip">
          muse-voice-transcribe
          <small>muse-spark</small>
        </div>
      </div>
      <div className="spend__bar" aria-hidden>
        <i />
        <em>$15 warn</em>
      </div>
      <p className="fine">AI stops automatically at {cap}. It can&apos;t overspend.</p>
    </div>
  );
}

function SettingsCards({
  book,
  pollOptions,
  accepting,
  needsClose,
  busy,
  onClose,
  when,
  counts,
  onDone,
  aiPaused,
  showPoll: pollOn,
  bookNumber,
  invitePath,
  bookType,
}: {
  book: { id: string; title: string; question: string; closesAt: string | null; pollQuestion: string };
  pollOptions: { label: string; votes: number }[];
  canChangeType: boolean;
  accepting: boolean;
  needsClose: boolean;
  aiPaused: boolean;
  showPoll: boolean;
  bookNumber: number;
  invitePath: string;
  bookType: string;
  busy: string | null;
  onClose: () => void;
  when: string;
  counts: { people: number; countries: number };
  onDone: () => void;
}) {
  const [question, setQuestion] = useState(book.question);
  const [title, setTitle] = useState(book.title);
  const [poll, setPoll] = useState(pollOptions.map((option) => option.label));
  const [message, setMessage] = useState<string | null>(null);
  const local = book.closesAt ? istParts(book.closesAt) : { date: "2026-10-26", time: "00:00" };
  const [date, setDate] = useState(local.date);
  const [time, setTime] = useState(local.time);
  const [showPoll, setShowPoll] = useState(pollOn);
  const [number, setNumber] = useState(String(bookNumber));
  const [pausedAi, setPausedAi] = useState(aiPaused);
  const dirtyQ = question !== book.question || title !== book.title || number !== String(bookNumber);
  const dirtyTime = date !== local.date || time !== local.time;
  const dirtyPoll = poll.some((label, index) => label !== (pollOptions[index]?.label ?? "")) || poll.length !== pollOptions.length;
  const shown = releaseLabel(new Date(fromIst(date, time || "00:00")));

  async function save(body: Record<string, unknown>) {
    const response = await fetch(`/api/books/${book.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error ?? "Not saved.");
      return;
    }
    setMessage(null);
    onDone();
  }

  const passed = book.closesAt ? new Date(book.closesAt).getTime() < Date.now() : true;
  return (
    <>
      <section className="setcard">
        <div className="setcard__head">
          <h2>The question</h2>
          <button className={`savepill${dirtyQ ? " on" : ""}`} type="button" disabled={!dirtyQ} onClick={() => void save({ title, question, bookNumber: Number(number) || 1 })}>
            Save
          </button>
        </div>
        <div className="live-grid">
          <div>
            <label className="field">
              <span>The question — on the cover and everywhere</span>
              <textarea className="ta" value={question} onChange={(event) => setQuestion(event.target.value)} />
            </label>
            <label className="field">
              <span>Book title</span>
              <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="field">
              <span>Book number</span>
              <input className="input" type="number" value={number} onChange={(event) => setNumber(event.target.value)} style={{ width: 88 }} />
            </label>
          </div>
          <BookCover compact question={question} people={counts.people} countries={counts.countries} names={[title]} />
        </div>
      </section>
      <section className="setcard">
        <div className="setcard__head">
          <h2>Release time</h2>
          <button
            className={`savepill${dirtyTime ? " on" : ""}`}
            type="button"
            disabled={!dirtyTime}
            onClick={() => void save({ closesAt: fromIst(date, time || "00:00") })}
          >
            Save
          </button>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <input className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          <input className="input" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
        </div>
        <p className="muted" style={{ fontSize: 14 }}>
          Shows as <b>{shown}</b> · short label <b>{shown.split(" · ")[0]}</b>
        </p>
        {passed ? <p style={{ color: "var(--red-text)", margin: "6px 0" }}>That time has passed</p> : null}
        <p className="muted" style={{ fontSize: 14, margin: 0 }}>
          The book is open.
          <br />
          Countdown and every date in the app update right away.
        </p>
      </section>
      <section className="setcard">
        <div className="setcard__head">
          <h2>Voices</h2>
          <span className="savepill">Save</span>
        </div>
        <div className="setrow" style={{ borderTop: 0 }}>
          <div>
            <b>Accepting voices</b>
            <div className="muted" style={{ fontSize: 14 }}>
              {accepting ? "On — people can add their voice" : "Off — voices are closed"}
            </div>
          </div>
          {needsClose && accepting ? (
            <button className={`toggle on`} type="button" disabled={busy !== null} aria-label="Close voices" onClick={onClose}>
              <i />
            </button>
          ) : (
            <span className={`toggle${accepting ? " on" : ""}`} aria-hidden>
              <i />
            </span>
          )}
        </div>
        <div className="setrow">
          <div>
            <b>Voices close at</b>
            <div className="muted" style={{ fontSize: 14 }}>
              Same as the release time
            </div>
          </div>
          <span>{when}</span>
        </div>
        <div className="setrow">
          <div>
            <b>Max voice length</b>
            <div className="muted" style={{ fontSize: 14 }}>
              Seconds per voice
            </div>
          </div>
          <input className="input" defaultValue={600} style={{ width: 88, minHeight: 42, textAlign: "center" }} />
        </div>
      </section>
      <section className="setcard">
        <div className="setcard__head">
          <h2>AI paused</h2>
        </div>
        <p className="muted" style={{ fontFamily: "var(--sans)", fontSize: 14.5 }}>
          When on, aiTick makes no AI calls — voice checking and book writing stop. New voices still save and wait.
        </p>
        <button
          className={`toggle${pausedAi ? " on" : ""}`}
          type="button"
          aria-pressed={pausedAi}
          onClick={() => {
            const next = !pausedAi;
            setPausedAi(next);
            void save({ aiPaused: next });
          }}
        >
          <i />
        </button>{" "}
        {pausedAi ? "AI is paused" : "AI is on"}
      </section>
      {bookType === "INVITED" ? (
        <section className="setcard">
          <h2>Invite link</h2>
          <p className="muted" style={{ fontFamily: "var(--sans)", fontSize: 14.5 }}>
            Only people with this link can add a voice. Each person has 3 left today.
          </p>
          <p>
            <a className="link" href={invitePath}>
              {invitePath}
            </a>
          </p>
        </section>
      ) : null}
      <section className="setcard">
        <div className="setcard__head">
          <h2>Next book poll</h2>
          <button
            className={`savepill${dirtyPoll ? " on" : ""}`}
            type="button"
            disabled={!dirtyPoll}
            onClick={() =>
              void save({
                pollQuestion: book.pollQuestion,
                pollOptions: poll.map((line) => line.trim()).filter(Boolean),
              })
            }
          >
            Save
          </button>
        </div>
        <p className="muted" style={{ fontFamily: "var(--sans)", fontSize: 14.5 }}>
          Readers vote on what Book 2 asks. Shown after release.
        </p>
        {poll.map((label, index) => (
          <label className="field" key={index}>
            <span>Option {index + 1}</span>
            <input
              className="input"
              value={label}
              onChange={(event) => setPoll((current) => current.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))}
            />
            <div className="muted" style={{ marginTop: 6 }}>
              {pollOptions[index]?.votes ?? 0} votes ·{" "}
              {pollOptions.reduce((sum, option) => sum + option.votes, 0)
                ? Math.round(((pollOptions[index]?.votes ?? 0) / pollOptions.reduce((sum, option) => sum + option.votes, 0)) * 100)
                : 0}
              %
            </div>
          </label>
        ))}
        <div className="setrow">
          <b>Show poll on the site</b>
          <button
            className={`toggle${showPoll ? " on" : ""}`}
            type="button"
            aria-pressed={showPoll}
            onClick={() => {
              const next = !showPoll;
              setShowPoll(next);
              void save({ showPoll: next });
            }}
          >
            <i />
          </button>
        </div>
        <button className="danger" type="button" style={{ marginTop: 8 }}>
          Reset all votes
        </button>
      </section>
      <section className="setcard">
        <h2>Sample data</h2>
        <p className="muted" style={{ fontFamily: "var(--sans)", fontSize: 14.5 }}>
          Sample voices, contributors, chapters and famous quotes are marked and can be removed in one go. Real voices stay.
        </p>
        <button className="danger" type="button">
          Remove sample data
        </button>
      </section>
      <section className="setcard">
        <h2>Reset test data</h2>
        <p className="muted" style={{ fontFamily: "var(--sans)", fontSize: 14.5 }}>
          Saves a backup, then removes every test voice, poll vote, draft, snapshot, spend-log row and job, and zeroes the AI spend. Settings, the owner login and all backups stay.
        </p>
        <button className="danger" type="button">
          Reset test data
        </button>
      </section>
      {message ? <p className="err">{message}</p> : null}
    </>
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
        sourceDate: data.get("sourceDate"),
        language: "en",
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error ?? "The quotation was not added.");
      return;
    }
    form.reset();
    onDone();
  }
  return (
    <form onSubmit={onSubmit} className="setcard">
      <h2>Famous replies</h2>
      <input className="input" name="speaker" placeholder="Who said it" required />
      <textarea className="ta" name="text" placeholder="The quotation, verbatim" required style={{ marginTop: 8 }} />
      <input className="input" name="sourceUrl" placeholder="https://source.example/article" required style={{ marginTop: 8 }} />
      <input className="input" name="sourceTitle" placeholder="Source title" style={{ marginTop: 8 }} />
      <input className="input" name="sourceDate" placeholder="1843" style={{ marginTop: 8 }} />
      {error ? <p className="err">{error}</p> : null}
      <button className="btn btn--sm" type="submit" style={{ marginTop: 10 }}>
        Add quote
      </button>
    </form>
  );
}

function sizeLabel(bytes: number) {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

function istParts(iso: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

function fromIst(date: string, time: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - 5.5 * 60 * 60 * 1000).toISOString();
}
