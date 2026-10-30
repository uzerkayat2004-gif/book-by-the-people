"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookCover } from "@/components/book-cover";
import { ShareLink } from "@/components/share-link";
import { AiModels, AudioTools, LocalModels } from "@/components/studio/ai-models";
import { isLocalType, modelChoices, modelLabel, type ProviderView } from "@/lib/ai/provider-types";
import { releaseLabel } from "@/lib/stage";
import { SPEAK_LANGUAGES } from "@/lib/speak-languages";

const STATUS_SHORT: Record<string, string> = {
  COLLECTING: "Open",
  CLOSED: "Closed",
  GENERATING: "Writing",
  REVIEW: "Review",
  PUBLISHED: "Released",
};

type StudioSettings = {
  language: string;
  voiceLimitPerDay: number;
  maxVoiceSeconds: number;
  hasAiKey: boolean;
  /** Last 4 characters of the saved book key, never the key itself. */
  aiKeyLast4?: string;
  canStoreKeys: boolean;
  /** This book has an AI to run on (its own key, a saved model, or the server's key). */
  aiReady: boolean;
  /** Which saved model this book runs on. providerId "" = the first in the creator's list. */
  bookModel: { providerId: string; model: string; options: { id: string; label: string; type: string; model: string; detail: string }[] };
  /** Home page placement. canFeature is true for the site owner. */
  home?: { onHome: boolean; featured: boolean; canFeature: boolean; eligible: boolean };
  /** No model of any kind is set up: the AI runs in demo mode. */
  mockMode: boolean;
  /** The server itself has no AI key (AI_MODE=mock). */
  mockServer: boolean;
};

type Checks = { onTopic?: boolean; realPerson?: boolean; copyPaste?: boolean; duplicate?: boolean; impersonation?: boolean };

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
  checks?: Checks | null;
};

type DraftRow = { id: string; version: number; provider: string; model: string; note: string; current: boolean };
type AiSummary = { writer: string | null; hearer: string | null; fallbacks: number; fallback?: boolean };
type Usage = { kind: "none" | "usd" | "tokens"; value: number; line: string; share: number | null; reached: boolean };

const TABS = [
  ["settings", "Book settings", "Settings"],
  ["ai", "AI at work", "AI"],
  ["make", "Make the book", "Make"],
  ["release", "Release", "Release"],
] as const;

type Tab = (typeof TABS)[number][0];

/** The eight checks every voice goes through, in order. */
const FLOW: { label: string; check?: keyof Checks; bad?: boolean }[] = [
  { label: "Transcribe" },
  { label: "Translate" },
  { label: "On topic", check: "onTopic", bad: false },
  { label: "Real person", check: "realPerson", bad: false },
  { label: "Copy-paste", check: "copyPaste", bad: true },
  { label: "Duplicate", check: "duplicate", bad: true },
  { label: "Impersonation", check: "impersonation", bad: true },
  { label: "Decide" },
];

/** How far a voice has got: the index of the step it is on (8 = through every step). */
function flowIndex(voice: VoiceRow) {
  switch (voice.pipelineStep) {
    case "waiting":
    case "paused":
    case "transcribe":
      return 0;
    case "translate":
      return 1;
    case "checks":
      return 7;
    case "decide":
    case "group":
      return 8;
    default:
      return voice.decision || voice.status !== "PROCESSING" ? 8 : 0;
  }
}

type VoiceState = "needs" | "approved" | "notused" | "hidden" | "working";

function stateOf(voice: VoiceRow): VoiceState {
  if (voice.hidden || voice.decision === "hidden" || voice.status === "HIDDEN") return "hidden";
  if (voice.decision === "needs_you" || voice.status === "NEEDS_YOU" || voice.status === "FAILED") return "needs";
  if (voice.decision === "not_used" || voice.status === "NOT_USED" || voice.status === "REJECTED") return "notused";
  if (voice.status === "READY") return "approved";
  return "working";
}

const STATE_LABEL: Record<VoiceState, string> = {
  needs: "Needs you",
  approved: "Approved",
  notused: "Not used",
  hidden: "Hidden",
  working: "Checking",
};

export function StudioDesk({
  book,
  voices,
  drafts,
  initialTab = "settings",
  pollOptions,
  canChangeType,
  usage,
  chapters,
  themes,
  books = [],
  backups = [],
  settings,
  media,
  aiPaused = false,
  showPoll = true,
  bookNumber = 1,
  providers = [],
  ai = { writer: null, hearer: null, fallbacks: 0, fallback: false },
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
    /** The book's own page to share (invited books carry their invite). */
    sharePath?: string;
    /** Link only: kept out of /books, the Library and the home page. */
    unlisted?: boolean;
    generationError: string | null;
    log: string[];
    paused: boolean;
  };
  voices: VoiceRow[];
  drafts: DraftRow[];
  initialTab?: Tab;
  pollOptions: { label: string; votes: number }[];
  canChangeType: boolean;
  usage: Usage;
  chapters: string[];
  themes: { label: string; count: number }[];
  books?: { id: string; slug: string; title: string; status?: string }[];
  backups?: { id: string; label: string; voices: number; note: string; restorable: boolean }[];
  settings: StudioSettings;
  media: { audioHref: string | null; videoHref: string | null; audioBytes: number; videoBytes: number; audioName: string; videoName: string; status: string; note: string | null; emails?: boolean };
  aiPaused?: boolean;
  showPoll?: boolean;
  bookNumber?: number;
  providers?: ProviderView[];
  ai?: AiSummary;
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

  const states = new Map(voices.map((voice) => [voice.id, stateOf(voice)]));
  const ready = voices.filter((voice) => states.get(voice.id) === "approved");
  const needsYou = voices.filter((voice) => states.get(voice.id) === "needs");
  const notUsed = voices.filter((voice) => states.get(voice.id) === "notused");
  const hidden = voices.filter((voice) => states.get(voice.id) === "hidden");
  const grouped = new Map<string, number>();
  for (const voice of voices) {
    const state = states.get(voice.id);
    if (!voice.themeLabel || state === "hidden" || state === "notused") continue;
    grouped.set(voice.themeLabel, (grouped.get(voice.themeLabel) ?? 0) + 1);
  }
  const groups = grouped.size ? [...grouped.entries()].map(([label, count]) => ({ label, count })) : themes;
  const needsClose = book.type === "OPEN" || book.type === "INVITED";
  const closedEnough = !needsClose || ["CLOSED", "REVIEW", "PUBLISHED"].includes(book.status);
  const accepting = book.status === "COLLECTING";
  const when = book.closesAt ? releaseLabel(new Date(book.closesAt)) : "Not set";
  const countries = new Set(ready.map((voice) => voice.countryCode).filter(Boolean)).size;
  const refresh = useCallback(() => router.refresh(), [router]);

  function go(next: Tab) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url.toString());
  }

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

  const voiceActions = {
    approve: (id: string) => run(`ok-${id}`, () => patchVoice(id, { decision: "approved" })),
    hide: (id: string) => run(`hide-${id}`, () => patchVoice(id, { decision: "hidden" })),
    show: (id: string) => run(`show-${id}`, () => patchVoice(id, { hidden: false })),
  };

  const writerLine = <b>{ai.writer ?? "Demo mode"}</b>;
  const openCount = books.filter((item) => item.status === "COLLECTING").length;
  const toLimit = () => {
    go("settings");
    window.setTimeout(() => document.getElementById("s-limit")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  return (
    <main className="page s2">
      <div className="s2-wrap">
        <header className="s2-bar">
          <nav className="s2-seg" role="tablist" aria-label="Studio steps">
            {TABS.map(([key, label, short], index) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "on" : ""} onClick={() => go(key)}>
                <b>{index + 1}</b>
                <span className="s2-seg__long">{label}</span>
                <span className="s2-seg__short">{short}</span>
                {key === "ai" && needsYou.length > 0 ? (
                  <em className="s2-badge" aria-label={`${needsYou.length} need you`}>
                    {needsYou.length}
                  </em>
                ) : null}
              </button>
            ))}
          </nav>
          <details className="s2-books">
            <summary aria-label="Switch book">
              <span>{book.title}</span>
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" />
              </svg>
            </summary>
            <div className="s2-books__pop" role="menu">
              <small>
                Your books{openCount > 1 ? ` · ${openCount} open now` : ""}
              </small>
              {books.map((item) => (
                <a key={item.id} role="menuitem" href={`/studio/${item.slug}?tab=${tab}`} className={item.id === book.id ? "on" : ""}>
                  <span className="s5-bk__t">{item.title}</span>
                  {item.status ? <em className={`s5-bk__s s5-bk__s--${item.status.toLowerCase()}`}>{STATUS_SHORT[item.status] ?? item.status}</em> : null}
                </a>
              ))}
              <a role="menuitem" className="s2-books__new" href="/books/new">
                + New book
              </a>
            </div>
          </details>
        </header>
        <h2 className="sr">
          {book.title} · {book.type} · {book.status}
        </h2>
        <ShareBar
          bookId={book.id}
          path={book.sharePath ?? `/b/${book.slug}`}
          title={book.title}
          unlisted={Boolean(book.unlisted)}
          invited={book.type === "INVITED"}
          onDone={refresh}
        />
        {usage.reached ? (
          <div className="s3-stop" role="status">
            <i aria-hidden />
            <div>
              <b>Usage limit reached · AI stopped</b>
              <span>{usage.line}</span>
            </div>
            <button className="s2-btn s2-btn--sm" type="button" onClick={toLimit}>
              Change limit
            </button>
          </div>
        ) : null}
        {error ? (
          <p className="s2-alert" role="alert">
            {error}
            <button type="button" aria-label="Dismiss" onClick={() => setError(null)}>
              ×
            </button>
          </p>
        ) : null}

        {tab === "settings" ? (
          <SettingsTab
            book={book}
            pollOptions={pollOptions}
            accepting={accepting}
            needsClose={needsClose}
            aiPaused={aiPaused}
            showPoll={showPoll}
            bookNumber={bookNumber}
            settings={settings}
            busy={busy}
            when={when}
            counts={{ people: ready.length, countries }}
            providers={providers}
            ai={ai}
            usage={usage}
            quotes={voices.filter((voice) => voice.kind === "sourced_quote")}
            onClose={() => run("close", () => post(`/api/books/${book.id}/close`).then(() => undefined))}
            onDone={refresh}
          />
        ) : null}

        {tab === "ai" ? (
          <AiTab
            voices={voices}
            states={states}
            counts={{ heard: voices.length, approved: ready.length, needs: needsYou.length, notUsed: notUsed.length, hidden: hidden.length }}
            needsYou={needsYou}
            groups={groups}
            busy={busy}
            writerLine={writerLine}
            usage={usage}
            bookId={book.id}
            actions={voiceActions}
            onRun={() => run("tick", () => post(`/api/books/${book.id}/tick`).then(() => undefined))}
            onDone={refresh}
          />
        ) : null}

        {tab === "make" ? (
          <MakeTab
            book={book}
            ready={ready.length}
            drafts={drafts}
            chapters={chapters}
            backups={backups}
            voices={voices.length}
            needsClose={needsClose}
            closedEnough={closedEnough}
            when={when}
            busy={busy}
            writerLine={writerLine}
            usage={usage}
            onMake={() => run("make", async () => void (await post(`/api/books/${book.id}/generate`)))}
            onQuick={() => run("local", () => post(`/api/books/${book.id}/generate?engine=local`).then(() => undefined))}
            onPublish={() => run("publish", () => post(`/api/books/${book.id}/publish`).then(() => undefined))}
            onBackup={() => run("backup", () => post(`/api/books/${book.id}/backup`).then(() => undefined))}
            onRestore={(id, label) => {
              if (!window.confirm(`Restore the backup from ${label.toLowerCase()}? The current state is backed up first.`)) return;
              void run("restore", () => post(`/api/books/${book.id}/backup/${id}/restore`).then(() => undefined));
            }}
            onDownload={() =>
              run("download", async () => {
                const response = await fetch(`/api/books/${book.id}/backup`, { method: "POST" });
                const data = (await response.json()) as { id?: string; error?: string };
                if (!response.ok || !data.id) throw new Error(data.error ?? "The backup was not saved.");
                window.location.href = `/api/books/${book.id}/backup/${data.id}`;
              })
            }
          />
        ) : null}

        {tab === "release" ? (
          <section className="s2-tab">
            <div className="s2-head">
              <div>
                <h1>Release</h1>
              </div>
            </div>
            <div className="s2-cols s2-cols--release">
              <div className="s2-stack">
                <ol className="s2-steps">
                  <li>
                    <i className={book.status === "PUBLISHED" ? "done" : ""}>{book.status === "PUBLISHED" ? <Tick /> : 1}</i>
                    <div>
                      <b>Book</b>
                      <span>{book.status === "PUBLISHED" ? "Published" : drafts.length ? `v${(drafts.find((draft) => draft.current) ?? drafts[0]).version} ready` : "No draft yet"} · {when}</span>
                    </div>
                    <button className="s2-link" type="button" onClick={() => go("settings")}>
                      Time
                    </button>
                  </li>
                  <MediaRow step={2} bookId={book.id} kind="audiobook" label="Audiobook" href={media.audioHref} name={media.audioName} bytes={media.audioBytes} />
                  <MediaRow step={3} bookId={book.id} kind="video" label="Video" href={media.videoHref} name={media.videoName} bytes={media.videoBytes} />
                </ol>
                <MakeMedia key={`${media.status}:${media.note ?? ""}`} bookId={book.id} status={media.status} note={media.note} hasDraft={drafts.length > 0} hasAudio={Boolean(media.audioHref)} />
                <p className="s4-note">
                  {media.emails
                    ? "Speakers get an email with the link when the book is out."
                    : "Emails to speakers are off. Add SMTP_URL (a free Gmail app password works) or RESEND_API_KEY to .env to turn them on."}
                </p>
                {book.status === "PUBLISHED" ? (
                  <a className="s2-btn s2-btn--red s2-btn--big" href={`/b/${book.slug}/read`}>
                    Read the book
                  </a>
                ) : (
                  <button
                    className="s2-btn s2-btn--red s2-btn--big"
                    type="button"
                    disabled={busy !== null || drafts.length === 0}
                    onClick={() => run("publish", () => post(`/api/books/${book.id}/publish`).then(() => undefined))}
                  >
                    {busy === "publish" ? "Publishing…" : drafts.length ? "Publish" : "Make the book first"}
                  </button>
                )}
                <p className="s3-quietline">
                  <CopyButton text={`${book.title}\n${book.question}\n${chapters.join("\n")}`} label="Copy text for audio and video" />
                  {book.status === "PUBLISHED" && drafts.length ? (
                    <button className="s2-link" type="button" disabled={busy !== null} onClick={() => run("publish", () => post(`/api/books/${book.id}/publish`).then(() => undefined))}>
                      {busy === "publish" ? "Publishing…" : "Publish latest version"}
                    </button>
                  ) : null}
                </p>
              </div>
              <div className="s2-cover">
                <BookCover title={book.title} question={book.question} people={ready.length} countries={countries} names={ready.map((voice) => voice.name)} />
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function AiTab({
  voices,
  states,
  counts,
  needsYou,
  groups,
  busy,
  writerLine,
  usage,
  bookId,
  actions,
  onRun,
  onDone,
}: {
  voices: VoiceRow[];
  states: Map<string, VoiceState>;
  counts: { heard: number; approved: number; needs: number; notUsed: number; hidden: number };
  needsYou: VoiceRow[];
  groups: { label: string; count: number }[];
  busy: string | null;
  writerLine: React.ReactNode;
  usage: Usage;
  bookId: string;
  actions: { approve: (id: string) => void; hide: (id: string) => void; show: (id: string) => void };
  onRun: () => void;
  onDone: () => void;
}) {
  const [all, setAll] = useState(false);
  const total = voices.length;
  const working = voices.filter((voice) => states.get(voice.id) === "working").length;
  const flow = FLOW.map((step, index) => {
    const passed = voices.filter((voice) => flowIndex(voice) > index).length;
    const active = voices.filter((voice) => flowIndex(voice) === index && voice.status === "PROCESSING").length;
    const flagged = step.check ? voices.filter((voice) => voice.checks && voice.checks[step.check!] !== undefined && voice.checks[step.check!] !== !step.bad).length : 0;
    return { ...step, passed, active, flagged };
  });
  const list = [...voices].reverse();
  const shown = all ? list : list.slice(0, 8);
  const maxGroup = Math.max(1, ...groups.map((group) => group.count));

  return (
    <section className="s2-tab">
      <div className="s2-head">
        <div>
          <h1>AI at work</h1>
          <p className="s3-status" aria-live="polite">
            <b>{total}</b> {total === 1 ? "voice" : "voices"} · <b>{counts.approved}</b> used · <b className={counts.needs ? "red" : ""}>{counts.needs}</b> need you
            {working ? <> · <span className="s2-live" aria-hidden /> {working} checking</> : null}
          </p>
        </div>
        <div className="s2-head__act">
          <button className="s2-btn s2-btn--red" type="button" disabled={busy !== null || usage.reached} onClick={onRun}>
            {busy === "tick" ? "Running…" : "Run AI now"}
          </button>
        </div>
      </div>

      <div className="s3-ai">
        {needsYou.length ? (
          <div className="s2-card s2-needs on">
            <div className="s2-card__head">
              <h3>Needs you</h3>
              <span className="s2-count">{needsYou.length}</span>
            </div>
            <ul className="s2-needs__list">
              {needsYou.map((voice) => (
                <li key={voice.id}>
                  <div>
                    <b>{voice.name}</b>
                    <q>{snippet(voice.englishText || voice.originalText, 160) || "No words heard."}</q>
                    <span className="s2-why">{voice.rejectReason || (voice.impersonation ? "Uses a public figure's name." : "The AI was not sure.")}</span>
                    {voice.status === "FAILED" && voice.hasAudio ? <FailedVoice voiceId={voice.id} onDone={onDone} /> : null}
                  </div>
                  <span className="s2-row">
                    {voice.status !== "FAILED" ? (
                      <button className="s2-btn s2-btn--sm s2-btn--red" type="button" disabled={busy !== null} onClick={() => actions.approve(voice.id)}>
                        Use
                      </button>
                    ) : null}
                    <button className="s2-btn s2-btn--sm s2-btn--ghost" type="button" disabled={busy !== null} onClick={() => actions.hide(voice.id)}>
                      Hide
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="s2-clear s3-clear">
            <i>
              <Tick />
            </i>{" "}
            Nothing needs you.
          </p>
        )}

        <div className="s2-card">
          <div className="s2-card__head">
            <h3>Voices</h3>
            <span className="s2-count">{total}</span>
          </div>
          {list.length === 0 ? (
            <p className="s4-empty">No voices yet. Share the link and they show up here.</p>
          ) : (
            <ul className="s2-voices">
              {shown.map((voice) => {
                const state = states.get(voice.id) ?? "working";
                return (
                  <li key={voice.id}>
                    <span className="s2-ava" aria-hidden>
                      {voice.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="s2-voices__main">
                      <b>
                        {voice.name}
                        {voice.impersonation ? <span className="s2-flag" title="Name of a public figure">name check</span> : null}
                      </b>
                      <span>{snippet(voice.englishText || voice.originalText, 90) || "—"}</span>
                    </div>
                    <span className={`s2-state s2-state--${state}`}>{STATE_LABEL[state]}</span>
                    {state === "hidden" ? (
                      <button className="s2-link" type="button" disabled={busy !== null} onClick={() => actions.show(voice.id)}>
                        Show
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {list.length > 8 ? (
            <button className="s2-link s3-all" type="button" onClick={() => setAll((value) => !value)}>
              {all ? "Show fewer" : `Show all ${list.length}`}
            </button>
          ) : null}
        </div>

        <details className="s3-details">
          <summary>Details</summary>
          <div className="s3-details__body">
            <p className="s3-kv">
              <span>Model</span>
              {writerLine}
            </p>
            <p className="s3-kv">
              <span>Usage</span>
              <b>{usage.line}</b>
            </p>
            <p className="s3-kv">
              <span>Not used · hidden</span>
              <b>
                {counts.notUsed} · {counts.hidden}
              </b>
            </p>
            <h4>Every voice goes through</h4>
            <ol className="s2-flow" aria-label="What happens to every voice">
              {flow.map((step, index) => {
                const share = total ? step.passed / total : 0;
                return (
                  <li key={step.label} className={`${step.active ? "active" : ""}${step.flagged ? " flagged" : ""}${total && step.passed === total ? " done" : ""}`}>
                    <span className="s2-flow__dot">{step.active ? <i className="s2-pulse" /> : index + 1}</span>
                    <span className="s2-flow__label">{step.label}</span>
                    <span className="s2-flow__bar" aria-hidden>
                      <i style={{ width: `${Math.round(share * 100)}%` }} />
                    </span>
                    <span className="s2-flow__n">{step.active ? `${step.active} now` : step.flagged ? `${step.flagged} flagged` : total ? `${step.passed}/${total}` : "—"}</span>
                  </li>
                );
              })}
            </ol>
            {groups.length ? (
              <>
                <h4>Groups</h4>
                <ul className="s2-groups">
                  {groups.map((group) => (
                    <li key={group.label}>
                      <span>{group.label}</span>
                      <b>{group.count}</b>
                      <i aria-hidden>
                        <em style={{ width: `${Math.round((group.count / maxGroup) * 100)}%` }} />
                      </i>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <h4>Add replies from X</h4>
            <XReplies bookId={bookId} onDone={onDone} />
          </div>
        </details>
      </div>
    </section>
  );
}

function MakeTab({
  book,
  ready,
  drafts,
  chapters,
  backups,
  voices,
  needsClose,
  closedEnough,
  when,
  busy,
  writerLine,
  usage,
  onMake,
  onQuick,
  onPublish,
  onBackup,
  onRestore,
  onDownload,
}: {
  book: { id: string; slug: string; status: string; log: string[] };
  ready: number;
  drafts: DraftRow[];
  chapters: string[];
  backups: { id: string; label: string; voices: number; note: string; restorable: boolean }[];
  voices: number;
  needsClose: boolean;
  closedEnough: boolean;
  when: string;
  busy: string | null;
  writerLine: React.ReactNode;
  usage: Usage;
  onMake: () => void;
  onQuick: () => void;
  onPublish: () => void;
  onBackup: () => void;
  onRestore: (id: string, label: string) => void;
  onDownload: () => void;
}) {
  const current = drafts.find((draft) => draft.current) ?? drafts[0] ?? null;
  const published = book.status === "PUBLISHED";
  const steps = [
    { label: "Voices", note: `${ready} in`, done: ready > 0 },
    { label: needsClose ? "Closed" : "Ready", note: needsClose ? (closedEnough ? "closed" : when.split(" · ")[0]) : "—", done: closedEnough },
    { label: "Draft", note: current ? `v${current.version}` : "—", done: drafts.length > 0 },
    { label: "Published", note: published ? "live" : "—", done: published },
  ];
  let primary: React.ReactNode;
  if (ready === 0) {
    primary = (
      <button className="s2-btn s2-btn--red s2-btn--big" type="button" disabled>
        Waiting for voices
      </button>
    );
  } else if (!current) {
    primary = (
      <button className="s2-btn s2-btn--red s2-btn--big" type="button" disabled={busy !== null || usage.reached} onClick={onMake}>
        {busy === "make" ? "Writing the book…" : "Make the book"}
      </button>
    );
  } else if (!published) {
    primary = (
      <button className="s2-btn s2-btn--red s2-btn--big" type="button" disabled={busy !== null} onClick={onPublish}>
        {busy === "publish" ? "Publishing…" : `Publish v${current.version}`}
      </button>
    );
  } else {
    primary = (
      <a className="s2-btn s2-btn--red s2-btn--big" href={`/b/${book.slug}/read`}>
        Read the book
      </a>
    );
  }

  return (
    <section className="s2-tab">
      <div className="s2-head">
        <div>
          <h1>Make the book</h1>
        </div>
      </div>
      <ol className="s2-stepper">
        {steps.map((step, index, all) => {
          const now = !step.done && all.slice(0, index).every((item) => item.done);
          return (
            <li key={step.label} className={step.done ? "done" : now ? "now" : ""}>
              <i>{step.done ? <Tick /> : index + 1}</i>
              <b>{step.label}</b>
              <span>{step.note}</span>
            </li>
          );
        })}
      </ol>
      <div className="s3-make">
        <div className="s2-card s3-make__main">
          {primary}
          <p className="s3-quietline">
            {current ? (
              <a className="s2-link" href={`/studio/${book.id}/editor`}>
                Edit draft
              </a>
            ) : null}
            {current ? (
              <button className="s2-link" type="button" disabled={busy !== null || usage.reached} onClick={onMake}>
                {busy === "make" ? "Writing…" : "Write a new version"}
              </button>
            ) : null}
            {!current && ready > 0 ? (
              <button className="s2-link" type="button" disabled={busy !== null} onClick={onQuick}>
                {busy === "local" ? "Assembling…" : "Quick draft without AI"}
              </button>
            ) : null}
            <span className="s3-model">{writerLine}</span>
          </p>
        </div>
        {chapters.length ? (
          <div className="s2-card">
            <div className="s2-card__head">
              <h3>Chapters</h3>
              <span className="s2-count">{chapters.length}</span>
            </div>
            <ol className="s2-chapters">
              {chapters.map((title, index) => (
                <li key={`${index}-${title}`}>
                  <i>{String(index + 1).padStart(2, "0")}</i>
                  {title}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        <details className="s3-details">
          <summary>Versions and backups</summary>
          <div className="s3-details__body">
            <h4>Versions</h4>
            {drafts.length === 0 ? (
              <p className="s2-muted">None yet.</p>
            ) : (
              <ul className="s2-list">
                {drafts.slice(0, 6).map((draft) => (
                  <li key={draft.id}>
                    <b>v{draft.version}</b>
                    <span className="s2-muted">
                      {draft.provider === "mock" ? "demo" : draft.provider} · {draft.model}
                    </span>
                    {draft.current ? <span className="s2-chip">current</span> : null}
                  </li>
                ))}
              </ul>
            )}
            <h4>Backups</h4>
            <ul className="s2-list">
              {backups.slice(0, 4).map((row) => (
                <li key={row.id}>
                  <span>
                    {row.label} · {row.voices} voices
                  </span>
                  <button className="s2-link" type="button" disabled={busy !== null || !row.restorable} onClick={() => onRestore(row.id, row.label)}>
                    Restore
                  </button>
                </li>
              ))}
              {backups.length === 0 ? <li className="s2-muted">No backups yet · {voices} voices</li> : null}
            </ul>
            <p className="s3-quietline">
              <button className="s2-link" type="button" disabled={busy !== null} onClick={onBackup}>
                {busy === "backup" ? "Saving…" : "Back up now"}
              </button>
              <button className="s2-link" type="button" disabled={busy !== null} onClick={onDownload}>
                Download backup
              </button>
            </p>
            {book.log.length ? <p className="s2-fine">Last run: {book.log[book.log.length - 1]}</p> : null}
          </div>
        </details>
      </div>
    </section>
  );
}

function Tick() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <path d="M3 7.4l2.6 2.6L11 4.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function snippet(text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function CopyButton({ text, label = "Copy" }: { text: string | (() => string); label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="s2-btn s2-btn--sm"
      type="button"
      onClick={() =>
        void navigator.clipboard.writeText(typeof text === "function" ? text() : text).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1600);
        })
      }
    >
      {done ? "Copied" : label}
    </button>
  );
}

/** A recording nobody could transcribe: listen to it, then type the words or try the AI again. */
function FailedVoice({ voiceId, onDone }: { voiceId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function send(transcript: string | null) {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/voices/${voiceId}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(transcript ? { transcript } : {}),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string; status?: string; rejectReason?: string | null };
    setBusy(false);
    if (!response.ok) return setError(data.error ?? "That did not work.");
    if (data.status === "FAILED") return setError(data.rejectReason ?? "Still no words. Type them instead.");
    onDone();
  }
  return (
    <div className="s4-failed">
      <audio controls preload="none" src={`/api/audio/${voiceId}`} />
      {open ? (
        <div className="s4-failed__type">
          <textarea className="s2-input" rows={3} value={text} placeholder="Type what they said" onChange={(event) => setText(event.target.value)} />
          <span className="s2-row">
            <button className="s2-btn s2-btn--sm s2-btn--red" type="button" disabled={busy || !text.trim()} onClick={() => void send(text)}>
              {busy ? "Saving…" : "Save words"}
            </button>
            <button className="s2-link" type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </span>
        </div>
      ) : (
        <span className="s2-row">
          <button className="s2-link" type="button" disabled={busy} onClick={() => setOpen(true)}>
            Type the words
          </button>
          <button className="s2-link" type="button" disabled={busy} onClick={() => void send(null)}>
            {busy ? "Trying…" : "Try AI again"}
          </button>
        </span>
      )}
      {error ? (
        <span className="s2-err" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** Speaks the book into the audiobook and video, in the background, and shows how it went. */
function MakeMedia({ bookId, status, note, hasDraft, hasAudio }: { bookId: string; status: string; note: string | null; hasDraft: boolean; hasAudio: boolean }) {
  const router = useRouter();
  const [state, setState] = useState(status);
  const [message, setMessage] = useState(note);
  useEffect(() => {
    if (state !== "running") return;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/books/${bookId}/media/render`).catch(() => null);
      const data = (await response?.json().catch(() => null)) as { status?: string; note?: string | null } | null;
      if (data?.status && data.status !== "running") {
        setState(data.status);
        setMessage(data.note ?? null);
        router.refresh();
      }
    }, 4000);
    return () => window.clearInterval(timer);
  }, [state, bookId, router]);
  async function start() {
    setState("running");
    setMessage(null);
    const response = await fetch(`/api/books/${bookId}/media/render`, { method: "POST" });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setState("failed");
      setMessage(data.error ?? "Could not start.");
    }
  }
  if (!hasDraft) return null;
  return (
    <div className={`s4-media s4-media--${state}`} aria-live="polite">
      <span>
        {state === "running" ? (
          <>
            <i className="s4-spin" aria-hidden /> Making the audiobook and video…
          </>
        ) : state === "failed" ? (
          message ?? "The audiobook could not be made."
        ) : message ? (
          message
        ) : hasAudio ? (
          "Made from the book text."
        ) : (
          "Spoken from the book text on this computer."
        )}
      </span>
      <button className="s2-link" type="button" disabled={state === "running"} onClick={() => void start()}>
        {hasAudio ? "Make again" : "Make audiobook"}
      </button>
    </div>
  );
}

function MediaRow({
  step,
  bookId,
  kind,
  label,
  href,
  name,
  bytes,
}: {
  step: number;
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
    <li>
      <i className={href ? "done" : ""}>{href ? <Tick /> : step}</i>
      <div>
        <b>{label}</b>
        <span>
          {busy ? (
            "Uploading…"
          ) : href ? (
            <>
              {name} · {sizeLabel(bytes)} ·{" "}
              <a className="s2-link" href={href}>
                Play
              </a>{" "}
              ·{" "}
              <a className="s2-link" href={`${href}?download=1`}>
                Download
              </a>
            </>
          ) : kind === "video" ? (
            "MP4"
          ) : (
            "MP3 or WAV"
          )}
        </span>
        {error ? (
          <span className="s2-err" role="alert">
            {error}
          </span>
        ) : null}
      </div>
      <label className="s2-btn s2-btn--sm s2-btn--ghost">
        {href ? "Replace" : "Upload"}
        <input type="file" accept={kind === "video" ? "video/mp4" : "audio/mpeg,audio/wav"} hidden onChange={(event) => void upload(event.target.files?.[0])} />
      </label>
    </li>
  );
}

function SettingsTab({
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
  settings,
  providers,
  ai,
  usage,
  quotes,
}: {
  book: { id: string; title: string; question: string; closesAt: string | null; pollQuestion: string; type: string; invitePath: string };
  pollOptions: { label: string; votes: number }[];
  accepting: boolean;
  needsClose: boolean;
  aiPaused: boolean;
  showPoll: boolean;
  bookNumber: number;
  settings: StudioSettings;
  busy: string | null;
  onClose: () => void;
  when: string;
  counts: { people: number; countries: number };
  onDone: () => void;
  providers: ProviderView[];
  ai: AiSummary;
  usage: Usage;
  quotes: VoiceRow[];
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
  const [addKey, setAddKey] = useState(0);
  const [bookProvider, setBookProvider] = useState(settings.bookModel.providerId);
  const [bookModelId, setBookModelId] = useState(settings.bookModel.model);
  const bookPicked = settings.bookModel.options.find((item) => item.id === bookProvider) ?? null;
  const dirtyModel = bookProvider !== settings.bookModel.providerId || (bookPicked !== null && (bookModelId || bookPicked.model) !== (settings.bookModel.model || bookPicked.model));
  const [limitKind, setLimitKind] = useState<Usage["kind"]>(usage.kind);
  const [limitValue, setLimitValue] = useState(usage.kind === "none" ? "" : String(usage.value));
  const dirtyLimit = limitKind !== usage.kind || (limitKind !== "none" && limitValue !== String(usage.value));
  const [working, setWorking] = useState<string | null>(null);
  const dirtyVoices = language !== settings.language || limit !== String(settings.voiceLimitPerDay) || seconds !== String(settings.maxVoiceSeconds);
  const dirtyQ = question !== book.question || title !== book.title || number !== String(bookNumber);
  const dirtyTime = date !== local.date || time !== local.time;
  const dirtyPoll = poll.some((label, index) => label !== (pollOptions[index]?.label ?? "")) || poll.length !== pollOptions.length;
  const shown = releaseLabel(new Date(fromIst(date, time || "00:00")));
  const totalVotes = pollOptions.reduce((sum, option) => sum + option.votes, 0);
  const [now] = useState(() => Date.now());
  const passed = book.closesAt ? new Date(book.closesAt).getTime() < now : true;

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

  const nav: [string, string][] = [
    ["s-question", "Question"],
    ["s-release", "Release time"],
    ...(settings.home ? ([["s-home", "Home page"]] as [string, string][]) : []),
    ["s-voices", "Voices"],
    ["s-poll", "Next book poll"],
    ...(book.type === "INVITED" ? ([["s-invite", "Invite link"]] as [string, string][]) : []),
    ...(book.type === "FAMOUS" ? ([["s-quotes", "Famous quotes"]] as [string, string][]) : []),
    ["s-limit", "AI for this book"],
    ["s-ai", "AI model"],
    ["s-data", "Data"],
  ];

  const saveButton = (dirty: boolean, onClick: () => void) => (
    <button className={`s2-save${dirty ? " on" : ""}`} type="button" disabled={!dirty} onClick={onClick}>
      {dirty ? "Save" : "Saved"}
    </button>
  );

  return (
    <section className="s2-tab">
      <div className="s2-head">
        <div>
          <h1>Book settings</h1>
        </div>
      </div>
      {message ? <p className="s2-alert">{message}</p> : null}
      {!settings.aiReady ? (
        <div className="s2-nokey" role="alert">
          <span className="s2-nokey__dot" aria-hidden />
          <div>
            <b>This book has no AI key yet</b>
            <span>Add one so the AI can hear voices and write the book.</span>
          </div>
          <a
            className="s2-btn s2-btn--sm s2-btn--red"
            href="#s-ai"
            onClick={() => setAddKey((tick) => tick + 1)}
          >
            Add a key
          </a>
        </div>
      ) : null}
      <div className="s2-settings">
        <nav className="s2-side" aria-label="Settings sections">
          {nav.map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </nav>
        <div className="s2-stack">
          <section className="s2-card" id="s-question">
            <div className="s2-card__head">
              <h3>The question</h3>
              {saveButton(dirtyQ, () => void save({ title, question, bookNumber: Number(number) || 1 }))}
            </div>
            <div className="s2-qgrid">
              <div>
                <label className="s2-field">
                  <span>
                    The question <em>on the cover and everywhere</em>
                  </span>
                  <textarea className="s2-input s2-ta" value={question} onChange={(event) => setQuestion(event.target.value)} />
                </label>
                <div className="s2-pair">
                  <label className="s2-field">
                    <span>Book title</span>
                    <input className="s2-input" value={title} onChange={(event) => setTitle(event.target.value)} />
                  </label>
                  <label className="s2-field">
                    <span>Number</span>
                    <input className="s2-input" type="number" min={1} value={number} onChange={(event) => setNumber(event.target.value)} />
                  </label>
                </div>
              </div>
              <div className="s2-qcover">
                <BookCover compact title={title} question={question} people={counts.people} countries={counts.countries} names={[title]} />
              </div>
            </div>
          </section>

          <section className="s2-card" id="s-release">
            <div className="s2-card__head">
              <h3>Release time</h3>
              {saveButton(dirtyTime, () => void save({ closesAt: fromIst(date, time || "00:00") }))}
            </div>
            <div className="s2-pair s2-pair--even">
              <label className="s2-field">
                <span>Date</span>
                <input className="s2-input" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              </label>
              <label className="s2-field">
                <span>Time (IST)</span>
                <input className="s2-input" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
              </label>
            </div>
            <p className="s2-fine">
              Shows as <b>{shown}</b>. Voices close at the same time.{passed ? <span className="s2-warn"> That time has passed.</span> : null}
            </p>
          </section>

          {settings.home ? <HomePlacement bookId={book.id} home={settings.home} onDone={onDone} /> : null}

          <section className="s2-card" id="s-voices">
            <div className="s2-card__head">
              <h3>Voices</h3>
              {saveButton(dirtyVoices, () =>
                void save({ language, voiceLimitPerDay: Number(limit) || 1, maxVoiceSeconds: Number(seconds) || 600 }),
              )}
            </div>
            <div className="s2-setrow">
              <div>
                <b>Accepting voices</b>
                <span>{accepting ? `On · closes ${when}` : "Off · voices are closed"}</span>
              </div>
              {needsClose && accepting ? (
                <button className="s2-switch on" type="button" role="switch" aria-checked disabled={busy !== null} aria-label="Close voices" onClick={onClose}>
                  <i />
                </button>
              ) : (
                <span className={`s2-switch${accepting ? " on" : ""}`} aria-hidden>
                  <i />
                </span>
              )}
            </div>
            <div className="s2-setrow">
              <div>
                <b>Max voice length</b>
                <span>Seconds per voice</span>
              </div>
              <input className="s2-input s2-num" type="number" min={15} max={600} aria-label="Max voice length in seconds" value={seconds} onChange={(event) => setSeconds(event.target.value)} />
            </div>
            <div className="s2-setrow">
              <div>
                <b>Voices per person a day</b>
                <span>Each person can add this many</span>
              </div>
              <input className="s2-input s2-num" type="number" min={1} max={50} aria-label="Voices per person a day" value={limit} onChange={(event) => setLimit(event.target.value)} />
            </div>
            <div className="s2-setrow">
              <div>
                <b>Main language</b>
                <span>Picked first on the Add your voice page</span>
              </div>
              <select className="s2-input s2-sel" aria-label="Main language" value={language} onChange={(event) => setLanguage(event.target.value)}>
                {SPEAK_LANGUAGES.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section className="s2-card" id="s-poll">
            <div className="s2-card__head">
              <h3>Next book poll</h3>
              {saveButton(dirtyPoll, () => void save({ pollQuestion: book.pollQuestion, pollOptions: poll.map((line) => line.trim()).filter(Boolean) }))}
            </div>
            <ul className="s2-poll">
              {poll.map((label, index) => {
                const votes = pollOptions[index]?.votes ?? 0;
                const pct = totalVotes ? Math.round((votes / totalVotes) * 100) : 0;
                return (
                  <li key={index}>
                    <input
                      className="s2-input"
                      aria-label={`Option ${index + 1}`}
                      value={label}
                      onChange={(event) => setPoll((current) => current.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))}
                    />
                    <span className="s2-poll__v">
                      <i style={{ width: `${pct}%` }} aria-hidden />
                      {votes} · {pct}%
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="s2-setrow">
              <b>Show the poll on the site</b>
              <button
                className={`s2-switch${showPoll ? " on" : ""}`}
                type="button"
                role="switch"
                aria-checked={showPoll}
                onClick={() => {
                  const next = !showPoll;
                  setShowPoll(next);
                  void save({ showPoll: next });
                }}
              >
                <i />
              </button>
            </div>
          </section>

          {book.type === "INVITED" ? (
            <section className="s2-card" id="s-invite">
              <div className="s2-card__head">
                <h3>Invite link</h3>
                <CopyButton text={() => `${window.location.origin}${book.invitePath}`} />
              </div>
              <p className="s2-fine">Only people with this link can add a voice, {settings.voiceLimitPerDay} a day each.</p>
              <code className="s2-code">{book.invitePath}</code>
            </section>
          ) : null}

          {book.type === "FAMOUS" ? <FamousQuotes bookId={book.id} mockMode={settings.mockServer} quotes={quotes} onDone={onDone} /> : null}

          <section className="s2-card" id="s-limit">
            <div className="s2-card__head">
              <h3>AI for this book</h3>
              {settings.aiReady ? null : <span className="s2-chip s2-chip--warn">No key yet</span>}
            </div>
            {settings.bookModel.options.length > 0 ? (
              <div className="s2-setrow s2-bookmodel">
                <div>
                  <b>Model</b>
                  <span>Runs this book</span>
                </div>
                <div className="s2-bookmodel__pick">
                  <select
                    className="s2-input"
                    aria-label="Model for this book"
                    value={bookProvider}
                    onChange={(event) => {
                      setBookProvider(event.target.value);
                      setBookModelId("");
                    }}
                  >
                    <option value="">First in your list</option>
                    {settings.bookModel.options.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                        {item.detail ? ` · ${item.detail}` : ""}
                      </option>
                    ))}
                  </select>
                  {bookPicked && modelChoices(bookPicked.type, bookPicked.model).length > 1 && !isLocalType(bookPicked.type) ? (
                    <select
                      className="s2-input s2-mono"
                      aria-label="Model id"
                      value={bookModelId || bookPicked.model}
                      onChange={(event) => setBookModelId(event.target.value)}
                    >
                      {modelChoices(bookPicked.type, bookModelId || bookPicked.model).map((name) => (
                        <option key={name} value={name}>
                          {modelLabel(name)}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {saveButton(dirtyModel, () => void save({ aiProviderId: bookProvider, aiModel: bookModelId }))}
                </div>
              </div>
            ) : null}
            <div className="s2-setrow">
              <div>
                <b>AI</b>
                <span>{usage.reached ? "Stopped · usage limit reached" : pausedAi ? "Paused" : "On"}</span>
              </div>
              <button
                className={`s2-switch${pausedAi ? "" : " on"}`}
                type="button"
                role="switch"
                aria-checked={!pausedAi}
                aria-label={pausedAi ? "Turn the AI on" : "Pause the AI"}
                onClick={() => {
                  const next = !pausedAi;
                  setPausedAi(next);
                  void save({ aiPaused: next });
                }}
              >
                <i />
              </button>
            </div>
            <div className="s3-limit">
              <div className="s3-limit__row">
                <b>Usage limit</b>
                <div className="s3-seg" role="radiogroup" aria-label="Usage limit">
                  {(
                    [
                      ["none", "No limit"],
                      ["usd", "Dollars"],
                      ["tokens", "Tokens"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={limitKind === key}
                      className={limitKind === key ? "on" : ""}
                      onClick={() => {
                        setLimitKind(key);
                        if (key === "none") setLimitValue("");
                        else if (key !== usage.kind) setLimitValue(key === "usd" ? "20" : "1000000000");
                        else setLimitValue(String(usage.value));
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {limitKind !== "none" ? (
                <div className="s3-limit__row">
                  <label className="s3-limit__input">
                    {limitKind === "usd" ? <span>$</span> : null}
                    <input
                      className="s2-input"
                      inputMode={limitKind === "usd" ? "decimal" : "text"}
                      placeholder={limitKind === "usd" ? "20" : "e.g. 1B"}
                      aria-label={limitKind === "usd" ? "Dollar limit" : "Token limit"}
                      value={limitValue}
                      onChange={(event) => setLimitValue(event.target.value)}
                    />
                    {limitKind === "tokens" ? <span>tokens</span> : null}
                  </label>
                  {limitKind === "tokens" ? (
                    <span className="s3-sugg">
                      {[
                        ["1M", "1000000"],
                        ["100M", "100000000"],
                        ["1B", "1000000000"],
                      ].map(([label, value]) => (
                        <button key={value} type="button" className={limitValue === value ? "on" : ""} onClick={() => setLimitValue(value)}>
                          {label}
                        </button>
                      ))}
                    </span>
                  ) : null}
                </div>
              ) : null}
              <div className="s3-limit__row">
                <span className={`s3-meter${usage.reached ? " full" : ""}`} aria-hidden>
                  <i style={{ width: `${Math.max(usage.share === null ? 0 : 1, Math.round((usage.share ?? 0) * 100))}%` }} />
                </span>
                <span className="s2-muted">{usage.line}</span>
                {saveButton(dirtyLimit, () => void save({ usageLimit: { kind: limitKind, value: limitKind === "none" ? 0 : limitValue } }))}
              </div>
            </div>
            <details className="s2-legacy">
              <summary>Book-only Meta key {settings.hasAiKey ? "· saved" : ""}</summary>
              {settings.hasAiKey ? (
                <div className="s2-setrow">
                  <b>Key saved ••••{settings.aiKeyLast4 ?? ""}</b>
                  <button className="s2-btn s2-btn--sm s2-btn--ghost" type="button" onClick={() => void save({ clearAiKey: true })}>
                    Remove
                  </button>
                </div>
              ) : null}
              {settings.canStoreKeys ? (
                <form
                  className="s2-row"
                  autoComplete="off"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!aiKey.trim()) return;
                    void save({ aiKey: aiKey.trim() }).then(() => setAiKey(""));
                  }}
                >
                  <input
                    className="s2-input"
                    type="password"
                    autoComplete="new-password"
                    aria-label="Book-only Meta key"
                    placeholder={settings.hasAiKey ? "Paste a new key" : "Paste a Meta key"}
                    value={aiKey}
                    onChange={(event) => setAiKey(event.target.value)}
                  />
                  <button className="s2-btn s2-btn--sm" type="submit" disabled={!aiKey.trim()}>
                    Save
                  </button>
                </form>
              ) : null}
            </details>
          </section>

          <section className="s2-card" id="s-ai">
            <div className="s2-card__head">
              <h3>AI model</h3>
              <span className="s2-chip">all your books</span>
            </div>
            <AiModels initial={providers} initialFallback={Boolean(ai.fallback)} mockServer={settings.mockServer} onChange={onDone} openNew={addKey} />
            <div className="s2-sub">
              <h4>Free Meta models</h4>
              <LocalModels onChange={onDone} />
            </div>
            <div className="s2-sub">
              <h4>Audio tools</h4>
              <AudioTools />
            </div>
          </section>

          <section className="s2-card s2-danger" id="s-data">
            <div className="s2-card__head">
              <h3>Data</h3>
              <span className="s2-muted">A backup is saved before each reset</span>
            </div>
            <div className="s2-setrow">
              <div>
                <b>Reset poll votes</b>
                <span>Removes every vote on the poll.</span>
              </div>
              <button className="s2-btn s2-btn--sm s2-btn--danger" type="button" disabled={working !== null} onClick={() => void maintenance("reset-votes", "Remove every vote on this poll?")}>
                Reset votes
              </button>
            </div>
            <div className="s2-setrow">
              <div>
                <b>Remove sample data</b>
                <span>Marked sample voices and quotes. Real voices stay.</span>
              </div>
              <button
                className="s2-btn s2-btn--sm s2-btn--danger"
                type="button"
                disabled={working !== null}
                onClick={() => void maintenance("remove-samples", "Remove the sample voices and sample quotes? Real voices stay.")}
              >
                Remove samples
              </button>
            </div>
            <div className="s2-setrow">
              <div>
                <b>Reset test data</b>
                <span>Every voice, vote, draft, job and spend row. Settings and backups stay.</span>
              </div>
              <button
                className="s2-btn s2-btn--sm s2-btn--danger"
                type="button"
                disabled={working !== null}
                onClick={() => void maintenance("reset-test-data", "Save a backup, then remove every voice, vote, draft, job and spend row for this book?")}
              >
                Reset
              </button>
            </div>
          </section>
        </div>
      </div>
    </section>
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
    <div className="s2-xr">
      <p className="s2-fine">
        One per line: <code>link | name | their exact words</code>. The date comes from the post.
      </p>
      <textarea className="s2-input s2-ta" placeholder="https://x.com/…/status/… | Name | words" value={text} onChange={(event) => setText(event.target.value)} />
      <div className="s2-row">
        <button className="s2-btn s2-btn--sm" type="button" disabled={busy || !text.trim()} onClick={importLines}>
          {busy ? "Importing…" : "Import"}
        </button>
        {note ? <span className="s2-muted">{note}</span> : null}
      </div>
    </div>
  );
}

function FamousQuotes({ bookId, quotes, mockMode, onDone }: { bookId: string; quotes: VoiceRow[]; mockMode: boolean; onDone: () => void }) {
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
    <section className="s2-card" id="s-quotes">
      <div className="s2-card__head">
        <h3>Famous quotes</h3>
        <span className="s2-count">{quotes.length}</span>
      </div>
      <p className="s2-fine">Real words only, exactly as said, with the source link and date. Both are shown in the book.</p>
      {quotes.length ? (
        <ul className="s2-quotes">
          {quotes.map((quote) => (
            <li key={quote.id}>
              <q>{quote.originalText}</q>
              <span className="s2-muted">
                {quote.name}
                {quote.sourceDate ? ` · ${quote.sourceDate}` : ""}
                {quote.sourceUrl ? (
                  <>
                    {" · "}
                    <a className="s2-link" href={quote.sourceUrl} target="_blank" rel="noreferrer">
                      {quote.sourceTitle?.replace(/^Sample · /, "") || "Source"}
                    </a>
                  </>
                ) : null}
                {quote.sourceTitle?.startsWith("Sample · ") ? <span className="s2-chip">sample</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <form onSubmit={onSubmit} className="s2-qform">
        <label className="s2-field">
          <span>Who said it</span>
          <input className="s2-input" name="speaker" placeholder="Ada Lovelace" required />
        </label>
        <label className="s2-field">
          <span>
            The quotation <em>verbatim</em>
          </span>
          <textarea className="s2-input s2-ta" name="text" required />
        </label>
        <div className="s2-pair">
          <label className="s2-field">
            <span>Source link</span>
            <input className="s2-input" name="sourceUrl" type="url" placeholder="https://…" required />
          </label>
          <label className="s2-field">
            <span>Date</span>
            <input className="s2-input" name="sourceDate" placeholder="1843" required />
          </label>
        </div>
        <label className="s2-field">
          <span>Source title</span>
          <input className="s2-input" name="sourceTitle" placeholder="Notes on the Analytical Engine" />
        </label>
        {error ? <p className="s2-err">{error}</p> : null}
        <div className="s2-row">
          <button className="s2-btn s2-btn--sm" type="submit" disabled={busy}>
            Add quote
          </button>
          {mockMode ? (
            <button className="s2-btn s2-btn--ghost s2-btn--sm" type="button" disabled={busy} onClick={() => void addSamples()}>
              Add labelled sample quotes
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

/** Where this book shows on the public site. The site owner can put it at the top of the home page. */
function HomePlacement({
  bookId,
  home,
  onDone,
}: {
  bookId: string;
  home: { onHome: boolean; featured: boolean; canFeature: boolean; eligible: boolean };
  onDone: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function feature(featured: boolean) {
    setWorking(true);
    const response = await fetch(`/api/books/${bookId}/feature`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ featured }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setWorking(false);
    setNote(response.ok ? null : (data.error ?? "That did not work."));
    if (response.ok) onDone();
  }
  const line = home.onHome
    ? home.featured
      ? "This book leads the home page. Other open books show below it, and released books stay in the Library."
      : "This book is on the home page right now because it is the newest open book."
    : home.eligible
      ? "This book shows under “Also open now” on the home page, or in the Library once released."
      : "Invited and solo books stay off the public pages until they are released.";
  return (
    <section className="s2-card" id="s-home" data-testid="home-placement">
      <div className="s2-card__head">
        <h3>Home page</h3>
        {home.onHome ? <span className="s2-chip">on the home page</span> : null}
      </div>
      <p className="s2-fine">{line}</p>
      {home.canFeature && home.eligible ? (
        <div className="s2-setrow">
          {home.featured ? (
            <button className="s2-btn s2-btn--sm s2-btn--ghost" type="button" disabled={working} onClick={() => void feature(false)}>
              Stop featuring
            </button>
          ) : (
            <button className="s2-btn s2-btn--sm" type="button" disabled={working} onClick={() => void feature(true)}>
              Feature on the home page
            </button>
          )}
        </div>
      ) : null}
      {note ? <p className="s2-warn">{note}</p> : null}
    </section>
  );
}

/** Top of every book's studio: its own link, copy and share, and whether it is listed in /books. */
function ShareBar({
  bookId,
  path,
  title,
  unlisted,
  invited,
  onDone,
}: {
  bookId: string;
  path: string;
  title: string;
  unlisted: boolean;
  invited: boolean;
  onDone: () => void;
}) {
  const [value, setValue] = useState(unlisted);
  const [note, setNote] = useState<string | null>(null);
  async function toggle() {
    const next = !value;
    setValue(next);
    setNote(null);
    const response = await fetch(`/api/books/${bookId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unlisted: next }),
    });
    if (!response.ok) {
      setValue(!next);
      setNote("That did not save.");
      return;
    }
    onDone();
  }
  return (
    <section className="s6-share" data-testid="studio-share">
      <div className="s6-share__text">
        <span className="s6-share__k">Your book&apos;s link</span>
        <a className="s6-share__url" href={path} target="_blank" rel="noreferrer">
          {path.split("?")[0]}
        </a>
      </div>
      <ShareLink path={path} title={title} big />
      <div className="s6-share__list">
        <button className={`s2-switch${value ? "" : " on"}`} type="button" role="switch" aria-checked={!value} aria-label="Show in Books" onClick={() => void toggle()}>
          <i />
        </button>
        <span>{invited ? "Invite only · never listed" : value ? "Unlisted · link only" : "Listed in Books"}</span>
        {note ? <em className="s2-warn">{note}</em> : null}
      </div>
    </section>
  );
}
