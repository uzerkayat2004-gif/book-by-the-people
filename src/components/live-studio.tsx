"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookCover } from "@/components/book-cover";
import { IconShield } from "@/components/icons";
import { releaseLabel } from "@/lib/stage";
import { SPEAK_LANGUAGES } from "@/lib/speak-languages";

type StudioSettings = {
  language: string;
  voiceLimitPerDay: number;
  maxVoiceSeconds: number;
  hasAiKey: boolean;
  canStoreKeys: boolean;
  mockMode: boolean;
};

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
  impersonation?: boolean;
  sourceTitle?: string | null;
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
  settings,
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
  backups?: { id: string; label: string; voices: number; note: string; restorable: boolean }[];
  settings: StudioSettings;
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
  const nameChecks = voices.filter((voice) => voice.impersonation);
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

  async function patchVoice(id: string, body: { decision?: "approved" | "hidden"; hidden?: boolean }) {
    const response = await fetch(`/api/voices/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? "That did not work.");
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
          <details className="bookswitch">
            <summary aria-label="Switch book">
              <span>{book.title}</span>
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" /></svg>
            </summary>
            <div className="bookswitch__pop" role="menu">
              {books.map((item) => (
                <a key={item.id} role="menuitem" href={`/studio/${item.slug}`} className={item.id === book.id ? "on" : ""}>
                  {item.title}
                </a>
              ))}
              <a role="menuitem" className="bookswitch__new" href="/books/new">
                + New book
              </a>
            </div>
          </details>
        </div>
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
              settings={settings}
              busy={busy}
              onClose={() => run("close", () => post(`/api/books/${book.id}/close`).then(() => undefined))}
              when={when}
              counts={{
                people: ready.length,
                countries: new Set(ready.map((voice) => voice.countryCode).filter(Boolean)).size,
              }}
              onDone={() => router.refresh()}
            />
            {book.type === "FAMOUS" ? (
              <FamousQuotes
                bookId={book.id}
                mockMode={settings.mockMode}
                quotes={voices.filter((voice) => voice.kind === "sourced_quote")}
                onDone={() => router.refresh()}
              />
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
                <Fragment key={step}>
                  {index ? <i aria-hidden /> : null}
                  <span style={{ ["--i" as string]: index }}>{step}</span>
                </Fragment>
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
                      <p key={voice.id} className="liverow">
                        <b>{voice.name}</b>
                        <span className="muted">{voice.decision ? voice.decision.replace("_", " ") : (voice.pipelineStep || voice.status).toLowerCase()}</span>
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
                <div className="section__head sub">
                  <h2 className="label">Needs your eye</h2>
                  <span className="cbadge">{needsYou.length}</span>
                </div>
                <div className="card bl">
                  {needsYou.length === 0
                    ? "All clear."
                    : needsYou.map((voice) => (
                        <div key={voice.id} className="eyerow">
                          <p>
                            <b>{voice.name}</b> — {voice.rejectReason || voice.englishText || voice.originalText || "Needs a look."}
                          </p>
                          <span className="eyerow__act">
                            {voice.status !== "FAILED" ? (
                              <button
                                type="button"
                                className="btn btn--sm btn--red"
                                disabled={busy !== null}
                                onClick={() => run(`ok-${voice.id}`, () => patchVoice(voice.id, { decision: "approved" }))}
                              >
                                Use it
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="btn btn--sm"
                              disabled={busy !== null}
                              onClick={() => run(`hide-${voice.id}`, () => patchVoice(voice.id, { decision: "hidden" }))}
                            >
                              Hide
                            </button>
                          </span>
                        </div>
                      ))}
                </div>
                <div className="section__head sub">
                  <h2 className="label">Name checks</h2>
                  <span className="cbadge">{nameChecks.length}</span>
                </div>
                <div className="card bl">
                  {nameChecks.length === 0
                    ? "No flagged names."
                    : nameChecks.map((voice) => (
                        <p key={voice.id} className="liverow">
                          <b>{voice.name}</b>
                          <span className="muted">{voice.decision === "approved" ? "you confirmed" : "public-figure name"}</span>
                        </p>
                      ))}
                </div>
                <div className="section__head sub">
                  <h2 className="label">Removed by AI</h2>
                  <span className="cbadge">{hidden.length}</span>
                </div>
                <div className="card bl">
                  {hidden.length === 0
                    ? "Nothing hidden."
                    : hidden.map((voice) => (
                        <p key={voice.id} className="liverow">
                          <b>{voice.name}</b>
                          <button
                            type="button"
                            className="linkbtn"
                            disabled={busy !== null}
                            onClick={() => run(`show-${voice.id}`, () => patchVoice(voice.id, { hidden: false }))}
                          >
                            Show
                          </button>
                        </p>
                      ))}
                </div>
                <div className="section__head sub">
                  <h2 className="label">Famous replies from X</h2>
                </div>
                <XReplies bookId={book.id} onDone={() => router.refresh()} />
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
                  disabled={busy !== null}
                  onClick={() =>
                    run("download", async () => {
                      const response = await fetch(`/api/books/${book.id}/backup`, { method: "POST" });
                      const data = (await response.json()) as { id?: string; error?: string };
                      if (!response.ok || !data.id) throw new Error(data.error ?? "The backup was not saved.");
                      window.location.href = `/api/books/${book.id}/backup/${data.id}`;
                    })
                  }
                >
                  Download backup
                </button>
              </div>
              <div className="makecol">
                <div className="card bl">
                  {chapters.length === 0 ? "The draft review appears here once the book is made. Nothing public changes until you publish a version." : chapters.map((title, index) => (
                        <p key={title}>
                          {index + 1} · {title}
                        </p>
                      ))}
                </div>
                <div className="card bl" style={{ marginTop: 12 }}>
                  <div className="label">
                    Versions <span style={{ float: "right" }}>{drafts.length} total</span>
                  </div>
                  {drafts.length === 0 ? <p>No versions yet.</p> : drafts.map((draft) => <p key={draft.id}>v{draft.version} · {draft.provider}</p>)}
                </div>
                <div className="card bl" style={{ marginTop: 12 }}>
                  <div className="label">Data health</div>
                  <p>
                    Voices: {voices.length} · Last backup: {backups[0] ? backups[0].label.toLowerCase() : "never"} · no data lost
                  </p>
                  <button className="btn btn--sm" type="button" disabled={busy !== null} onClick={() => run("backup", () => post(`/api/books/${book.id}/backup`).then(() => undefined))}>
                    {busy === "backup" ? "Saving…" : "Backup now"}
                  </button>
                  {backups.length === 0 ? <p className="muted">No backups yet.</p> : null}
                  {backups.map((row) => (
                    <div className="setrow" key={row.id}>
                      <span>
                        {row.label} · {row.voices} voices
                      </span>
                      <button
                        className="btn btn--ghost btn--sm"
                        type="button"
                        disabled={busy !== null || !row.restorable}
                        title={row.restorable ? "Put voices, drafts and votes back to this point" : "This backup only kept a count"}
                        onClick={() => {
                          if (!window.confirm(`Restore the backup from ${row.label.toLowerCase()}? The current state is backed up first.`)) return;
                          void run("restore", () => post(`/api/books/${book.id}/backup/${row.id}/restore`).then(() => undefined));
                        }}
                      >
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
                <MediaRow bookId={book.id} kind="audiobook" label="2 · Audio" href={media.audioHref} name={media.audioName} bytes={media.audioBytes} />
                <MediaRow bookId={book.id} kind="video" label="3 · Video" href={media.videoHref} name={media.videoName} bytes={media.videoBytes} />
                <div style={{ marginTop: 16 }}>{publishButton(true)}</div>
              </div>
              <div className="relprev">
                <BookCover title={book.title} question={book.question} people={ready.length} countries={new Set(ready.map((voice) => voice.countryCode).filter(Boolean)).size} names={ready.map((voice) => voice.name)} />
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

function MediaRow({
  bookId,
  kind,
  label,
  href,
  name,
  bytes,
}: {
  bookId: string;
  kind: "audiobook" | "video";
  label: string;
  href: string | null;
  name: string;
  bytes: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    const form = new FormData();
    form.set("kind", kind);
    form.set("file", file);
    const response = await fetch(`/api/books/${bookId}/media`, { method: "POST", body: form });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setError(data.error ?? "Upload failed.");
      return;
    }
    router.refresh();
  }
  return (
    <div className="card upl" style={{ marginTop: 12 }}>
      <div>
        <b>{label}</b>
        <div className="muted">
          {busy ? (
            "Uploading…"
          ) : href ? (
            <>
              ✓ {name} · {sizeLabel(bytes)}{" "}
              <a className="link" href={href}>
                Play
              </a>{" "}
              <a className="link" href={`${href}?download=1`}>
                Download
              </a>
            </>
          ) : (
            <>{kind === "video" ? "Made from the book when you release" : "Read aloud from the book when you release"}</>
          )}
        </div>
        {error ? <div className="err" role="alert">{error}</div> : null}
      </div>
      <label className="btn btn--ghost btn--sm">
        {href ? "Replace" : "Upload"}
        <input
          type="file"
          accept={kind === "video" ? "video/mp4" : "audio/mpeg,audio/wav"}
          hidden
          onChange={(event) => void upload(event.target.files?.[0])}
        />
      </label>
    </div>
  );
}

function Spend({ spend }: { spend: { usd: string; cap: string | null } }) {
  const cap = spend.cap ?? "no cap";
  const capUsd = Number(cap.replace(/[^0-9.]/g, "")) || 0;
  const usedUsd = Number(spend.usd.replace(/[^0-9.]/g, "")) || 0;
  const share = capUsd ? Math.min(1, usedUsd / capUsd) : 0;
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
        <i style={{ width: share > 0.01 ? `${share * 100}%` : undefined }} />
        {capUsd ? <em>${Math.round(capUsd * 0.75)} warn</em> : null}
      </div>
      <p className="fine">{cap === "no cap" ? "No spend cap is set (AI_SPEND_CAP_USD)." : <>AI stops automatically at {cap}. It can&apos;t overspend.</>}</p>
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
  settings,
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
  settings: StudioSettings;
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
  const [language, setLanguage] = useState(settings.language);
  const [limit, setLimit] = useState(String(settings.voiceLimitPerDay));
  const [seconds, setSeconds] = useState(String(settings.maxVoiceSeconds));
  const [aiKey, setAiKey] = useState("");
  const [working, setWorking] = useState<string | null>(null);
  const dirtyVoices =
    language !== settings.language || limit !== String(settings.voiceLimitPerDay) || seconds !== String(settings.maxVoiceSeconds);
  async function maintenance(action: string, confirmText: string) {
    if (!window.confirm(confirmText)) return;
    setWorking(action);
    const response = await fetch(`/api/books/${book.id}/maintenance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string; removed?: number };
    setWorking(null);
    if (!response.ok) {
      setMessage(data.error ?? "That did not work.");
      return;
    }
    setMessage(typeof data.removed === "number" ? `Removed ${data.removed}.` : "Done. A backup was saved first.");
    onDone();
  }
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
              <span>
                The question <em>— on the cover and everywhere</em>
              </span>
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
          <BookCover compact title={title} question={question} people={counts.people} countries={counts.countries} names={[title]} />
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
        <div className="timerow" style={{ display: "flex", gap: 10 }}>
          <input className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          <input className="input" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
        </div>
        <p className="muted" style={{ fontSize: 14 }}>
          Shows as <b>{shown}</b> · short label <b>{shown.split(" · ")[0]}</b>
        </p>
        {passed ? <p className="passed">That time has passed</p> : null}
        <p className="muted" style={{ fontSize: 14, margin: 0 }}>
          The book is open.
          <br />
          Countdown and every date in the app update right away.
        </p>
      </section>
      <section className="setcard">
        <div className="setcard__head">
          <h2>Voices</h2>
          <button
            className={`savepill${dirtyVoices ? " on" : ""}`}
            type="button"
            disabled={!dirtyVoices}
            onClick={() =>
              void save({
                language,
                voiceLimitPerDay: Number(limit) || 1,
                maxVoiceSeconds: Number(seconds) || 600,
              })
            }
          >
            Save
          </button>
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
          <input
            className="input"
            type="number"
            min={15}
            max={600}
            aria-label="Max voice length in seconds"
            value={seconds}
            onChange={(event) => setSeconds(event.target.value)}
            style={{ width: 88, minHeight: 42, textAlign: "center" }}
          />
        </div>
        <div className="setrow">
          <div>
            <b>Voices per person a day</b>
            <div className="muted" style={{ fontSize: 14 }}>
              Each person can add this many
            </div>
          </div>
          <input
            className="input"
            type="number"
            min={1}
            max={50}
            aria-label="Voices per person a day"
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
            style={{ width: 88, minHeight: 42, textAlign: "center" }}
          />
        </div>
        <div className="setrow">
          <div>
            <b>Main language</b>
            <div className="muted" style={{ fontSize: 14 }}>
              Picked first on the speak page
            </div>
          </div>
          <select className="input" aria-label="Main language" value={language} onChange={(event) => setLanguage(event.target.value)} style={{ width: 160, minHeight: 42 }}>
            {SPEAK_LANGUAGES.map((item) => (
              <option key={item.code} value={item.code}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </section>
      <section className="setcard">
        <div className="setcard__head">
          <h2>Your AI key</h2>
        </div>
        <p className="muted" style={{ fontFamily: "var(--sans)", fontSize: 14.5 }}>
          The app is free; the AI runs on your own Meta key for this book. It is encrypted on the server and never shown again.
          {settings.mockMode ? " This server runs in mock mode, so no key is used right now." : ""}
        </p>
        {settings.hasAiKey ? (
          <div className="setrow" style={{ borderTop: 0 }}>
            <b>Key saved · encrypted</b>
            <button className="btn btn--ghost btn--sm" type="button" onClick={() => void save({ clearAiKey: true })}>
              Remove key
            </button>
          </div>
        ) : null}
        {settings.canStoreKeys ? (
          <form
            className="timerow"
            style={{ display: "flex", gap: 10 }}
            onSubmit={(event) => {
              event.preventDefault();
              if (!aiKey.trim()) return;
              void save({ aiKey: aiKey.trim() }).then(() => setAiKey(""));
            }}
          >
            <input
              className="input"
              type="password"
              autoComplete="off"
              aria-label="Your AI key"
              placeholder={settings.hasAiKey ? "Paste a new key to replace it" : "Paste your META_API_KEY"}
              value={aiKey}
              onChange={(event) => setAiKey(event.target.value)}
            />
            <button className="btn btn--sm" type="submit" disabled={!aiKey.trim()}>
              Save key
            </button>
          </form>
        ) : (
          <p className="muted">Key storage is off on this server (AI_KEY_SECRET is not set).</p>
        )}
      </section>
      <section className="setcard">
        <div className="setcard__head">
          <h2>AI paused</h2>
        </div>
        <p className="muted" style={{ fontFamily: "var(--sans)", fontSize: 14.5 }}>
          When on, aiTick makes no AI calls — voice checking and book writing stop. New voices still save and wait.
        </p>
        <div className="togglerow">
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
        </button>
        <span className="tlabel">{pausedAi ? "AI is paused" : "AI is on"}</span>
        </div>
      </section>
      {bookType === "INVITED" ? (
        <section className="setcard">
          <h2>Invite link</h2>
          <p className="muted" style={{ fontFamily: "var(--sans)", fontSize: 14.5 }}>
            Only people with this link can add a voice. Each person can add {settings.voiceLimitPerDay} a day.
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
        <button
          className="danger"
          type="button"
          style={{ marginTop: 8 }}
          disabled={working !== null}
          onClick={() => void maintenance("reset-votes", "Remove every vote on this poll?")}
        >
          Reset all votes
        </button>
      </section>
      <section className="setcard">
        <h2>Sample data</h2>
        <p className="muted" style={{ fontFamily: "var(--sans)", fontSize: 14.5 }}>
          Sample voices, contributors, chapters and famous quotes are marked and can be removed in one go. Real voices stay.
        </p>
        <button
          className="danger"
          type="button"
          disabled={working !== null}
          onClick={() => void maintenance("remove-samples", "Remove the sample voices and sample quotes? Real voices stay.")}
        >
          Remove sample data
        </button>
      </section>
      <section className="setcard">
        <h2>Reset test data</h2>
        <p className="muted" style={{ fontFamily: "var(--sans)", fontSize: 14.5 }}>
          Saves a backup, then removes every voice, poll vote, draft, spend-log row and job, and zeroes the AI spend. Settings, the owner login and all backups stay.
        </p>
        <button
          className="danger"
          type="button"
          disabled={working !== null}
          onClick={() =>
            void maintenance("reset-test-data", "Save a backup, then remove every voice, vote, draft, job and spend row for this book?")
          }
        >
          Reset test data
        </button>
      </section>
      {message ? <p className="err">{message}</p> : null}
    </>
  );
}

function XReplies({ bookId, onDone }: { bookId: string; onDone: () => void }) {
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function importLines() {
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) return;
    setBusy(true);
    setNote(null);
    let added = 0;
    const problems: string[] = [];
    for (const line of lines) {
      const [url = "", name = "", ...rest] = line.split("|").map((part) => part.trim());
      const response = await fetch(`/api/books/${bookId}/quotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speaker: name, text: rest.join(" | "), sourceUrl: url, sourceTitle: "Reply on X", language: "en" }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) added += 1;
      else problems.push(data.error ?? "Not added.");
    }
    setBusy(false);
    setNote(`${added} added.${problems.length ? ` ${problems[0]}` : ""}`);
    if (added) {
      setText("");
      onDone();
    }
  }
  return (
    <div className="card bl">
      <p className="muted xnote">
        Paste reply links, one per line, as <code>link | name | their exact words</code>. They go through the same AI checks. The date comes from the post ID — typed names alone never get a ✓.
      </p>
      <textarea className="ta" placeholder="https://x.com/…/status/… | Name | words" value={text} onChange={(event) => setText(event.target.value)} />
      <div className="liverow" style={{ marginTop: 10 }}>
        <button className="btn btn--sm" type="button" disabled={busy || !text.trim()} onClick={importLines}>
          {busy ? "Importing…" : "Import"}
        </button>
        {note ? <span className="muted">{note}</span> : null}
      </div>
    </div>
  );
}

function FamousQuotes({
  bookId,
  quotes,
  mockMode,
  onDone,
}: {
  bookId: string;
  quotes: VoiceRow[];
  mockMode: boolean;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
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
    const payload = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setError(payload.error ?? "The quotation was not added.");
      return;
    }
    setError(null);
    form.reset();
    onDone();
  }
  async function addSamples() {
    setBusy(true);
    const response = await fetch(`/api/books/${bookId}/quotes/samples`, { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) setError(payload.error ?? "Samples were not added.");
    else onDone();
  }
  return (
    <section className="setcard">
      <div className="setcard__head">
        <h2>Famous quotes</h2>
        <span className="muted">{quotes.length} added</span>
      </div>
      <p className="muted" style={{ fontFamily: "var(--sans)", fontSize: 14.5 }}>
        Only real words, exactly as said. Every quote needs the source link and the date; both are shown in the book.
      </p>
      {quotes.length ? (
        <ul className="quotelist">
          {quotes.map((quote) => (
            <li key={quote.id}>
              <q>{quote.originalText}</q>
              <div className="muted">
                {quote.name}
                {quote.sourceDate ? ` · ${quote.sourceDate}` : ""}
                {quote.sourceUrl ? (
                  <>
                    {" · "}
                    <a className="link" href={quote.sourceUrl} target="_blank" rel="noreferrer">
                      {quote.sourceTitle?.replace(/^Sample · /, "") || "Source"}
                    </a>
                  </>
                ) : null}
                {quote.sourceTitle?.startsWith("Sample · ") ? <span className="samplechip">sample</span> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <form onSubmit={onSubmit} className="quoteform">
        <label className="field">
          <span>Who said it</span>
          <input className="input" name="speaker" placeholder="Ada Lovelace" required />
        </label>
        <label className="field">
          <span>
            The quotation <em>— verbatim</em>
          </span>
          <textarea className="ta" name="text" required />
        </label>
        <div className="quoteform__row">
          <label className="field">
            <span>Source link</span>
            <input className="input" name="sourceUrl" type="url" placeholder="https://…" required />
          </label>
          <label className="field">
            <span>Date</span>
            <input className="input" name="sourceDate" placeholder="1843" required />
          </label>
        </div>
        <label className="field">
          <span>Source title</span>
          <input className="input" name="sourceTitle" placeholder="Notes on the Analytical Engine" />
        </label>
        {error ? <p className="err">{error}</p> : null}
        <div className="liverow">
          <button className="btn btn--sm" type="submit" disabled={busy}>
            Add quote
          </button>
          {mockMode ? (
            <button className="btn btn--ghost btn--sm" type="button" disabled={busy} onClick={() => void addSamples()}>
              Add labeled sample quotes
            </button>
          ) : null}
        </div>
      </form>
    </section>
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
