"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookCover } from "@/components/book-cover";
import { AiModels, LocalModels } from "@/components/studio/ai-models";
import type { ProviderView } from "@/lib/ai/provider-types";
import { releaseLabel } from "@/lib/stage";
import { SPEAK_LANGUAGES } from "@/lib/speak-languages";

type StudioSettings = {
  language: string;
  voiceLimitPerDay: number;
  maxVoiceSeconds: number;
  hasAiKey: boolean;
  canStoreKeys: boolean;
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
type AiSummary = { writer: string | null; hearer: string | null; fallbacks: number };

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
  providers = [],
  ai = { writer: null, hearer: null, fallbacks: 0 },
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

  const writerLine = ai.writer ? (
    <>
      <b>{ai.writer}</b>
      {ai.fallbacks ? <span> · {ai.fallbacks} fallback{ai.fallbacks === 1 ? "" : "s"}</span> : null}
    </>
  ) : (
    <>
      <b>Demo mode</b>
      <span> · no model yet</span>
    </>
  );

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
              <small>Your books</small>
              {books.map((item) => (
                <a key={item.id} role="menuitem" href={`/studio/${item.slug}?tab=${tab}`} className={item.id === book.id ? "on" : ""}>
                  {item.title}
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
        {book.paused ? <p className="s2-alert">Voices are paused: the spend cap is reached. New recordings wait until it is raised.</p> : null}
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
            spend={spend}
            bookId={book.id}
            actions={voiceActions}
            onRun={() => run("tick", () => post(`/api/books/${book.id}/tick`).then(() => undefined))}
            onDone={refresh}
          />
        ) : null}

        {tab === "make" ? (
          <section className="s2-tab">
            <div className="s2-head">
              <div>
                <h1>Make the book</h1>
                <p>Chapters are shaped from the voices. Drafts stay private until you publish.</p>
              </div>
            </div>
            <ol className="s2-stepper">
              {[
                { label: "Voices in", note: `${ready.length} approved`, done: ready.length > 0 },
                { label: needsClose ? "Voices closed" : "Ready", note: needsClose ? (closedEnough ? "closed" : `closes ${when.split(" · ")[0]}`) : "no closing needed", done: closedEnough },
                { label: "Draft written", note: drafts.length ? `v${drafts[0].version}` : "not yet", done: drafts.length > 0 },
                { label: "Published", note: book.status === "PUBLISHED" ? "live" : "not yet", done: book.status === "PUBLISHED" },
              ].map((step, index, all) => {
                const current = !step.done && all.slice(0, index).every((item) => item.done);
                return (
                  <li key={step.label} className={step.done ? "done" : current ? "now" : ""}>
                    <i>{step.done ? <Tick /> : index + 1}</i>
                    <b>{step.label}</b>
                    <span>{step.note}</span>
                  </li>
                );
              })}
            </ol>
            <div className="s2-cols">
              <div className="s2-stack">
                <div className="s2-card">
                  <div className="s2-card__head">
                    <h3>Write a draft</h3>
                  </div>
                  <p className="s2-writer">Writer: {writerLine}</p>
                  <button
                    className="s2-btn s2-btn--red s2-btn--big"
                    type="button"
                    disabled={busy !== null}
                    onClick={() => run("make", async () => void (await post(`/api/books/${book.id}/generate`)))}
                  >
                    {busy === "make" ? "Writing the book…" : drafts.length ? "Write a new version" : "Make the book"}
                  </button>
                  <div className="s2-row">
                    {drafts.length > 0 ? (
                      <button
                        className="s2-btn"
                        type="button"
                        disabled={busy !== null}
                        onClick={() => run("publish", () => post(`/api/books/${book.id}/publish`).then(() => undefined))}
                      >
                        {busy === "publish" ? "Publishing…" : `Publish v${drafts.find((draft) => draft.current)?.version ?? drafts[0].version}`}
                      </button>
                    ) : null}
                    {drafts.length > 0 ? (
                      <a className="s2-btn s2-btn--ghost" href={`/studio/${book.id}/editor`}>
                        Edit the draft
                      </a>
                    ) : null}
                    {book.status === "PUBLISHED" ? (
                      <a className="s2-btn s2-btn--ghost" href={`/b/${book.slug}/read`}>
                        Read
                      </a>
                    ) : null}
                    <button
                      className="s2-link"
                      type="button"
                      disabled={busy !== null || ready.length === 0}
                      title="Groups the voices into chapters without calling any AI model"
                      onClick={() => run("local", () => post(`/api/books/${book.id}/generate?engine=local`).then(() => undefined))}
                    >
                      {busy === "local" ? "Assembling…" : "Quick draft without AI"}
                    </button>
                  </div>
                  {book.log.length ? <p className="s2-fine">Last run: {book.log[book.log.length - 1]}</p> : null}
                </div>
                <div className="s2-card">
                  <div className="s2-card__head">
                    <h3>Chapters</h3>
                    <span className="s2-count">{chapters.length}</span>
                  </div>
                  {chapters.length === 0 ? (
                    <p className="s2-muted">Chapters appear here once a draft is written.</p>
                  ) : (
                    <ol className="s2-chapters">
                      {chapters.map((title, index) => (
                        <li key={`${index}-${title}`}>
                          <i>{String(index + 1).padStart(2, "0")}</i>
                          {title}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
              <div className="s2-stack">
                <div className="s2-card">
                  <div className="s2-card__head">
                    <h3>Versions</h3>
                    <span className="s2-count">{drafts.length}</span>
                  </div>
                  {drafts.length === 0 ? (
                    <p className="s2-muted">No versions yet.</p>
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
                </div>
                <div className="s2-card">
                  <div className="s2-card__head">
                    <h3>Backups</h3>
                    <button
                      className="s2-btn s2-btn--sm"
                      type="button"
                      disabled={busy !== null}
                      onClick={() => run("backup", () => post(`/api/books/${book.id}/backup`).then(() => undefined))}
                    >
                      {busy === "backup" ? "Saving…" : "Back up now"}
                    </button>
                  </div>
                  <p className="s2-muted">
                    {voices.length} voices · last backup {backups[0] ? backups[0].label.toLowerCase() : "never"}
                  </p>
                  <ul className="s2-list">
                    {backups.slice(0, 4).map((row) => (
                      <li key={row.id}>
                        <span>
                          {row.label} · {row.voices} voices
                        </span>
                        <button
                          className="s2-link"
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
                      </li>
                    ))}
                  </ul>
                  <button
                    className="s2-link"
                    type="button"
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
                    Download a backup file
                  </button>
                </div>
                <Spend spend={spend} writer={ai.writer} />
              </div>
            </div>
          </section>
        ) : null}

        {tab === "release" ? (
          <section className="s2-tab">
            <div className="s2-head">
              <div>
                <h1>Release</h1>
                <p>Publish the book, then add its audio and video.</p>
              </div>
            </div>
            <div className="s2-cols s2-cols--release">
              <div className="s2-stack">
                <ol className="s2-steps">
                  <li>
                    <i>1</i>
                    <div>
                      <b>Release time</b>
                      <span>{when}</span>
                    </div>
                    <button className="s2-btn s2-btn--sm s2-btn--ghost" type="button" onClick={() => go("settings")}>
                      Change
                    </button>
                  </li>
                  <li>
                    <i>2</i>
                    <div>
                      <b>Copy for NotebookLM</b>
                      <span>Title, question and chapters, for the audio and video</span>
                    </div>
                    <CopyButton text={`${book.title}\n${book.question}\n${chapters.join("\n")}`} />
                  </li>
                  <MediaRow step={3} bookId={book.id} kind="audiobook" label="Audiobook" href={media.audioHref} name={media.audioName} bytes={media.audioBytes} />
                  <MediaRow step={4} bookId={book.id} kind="video" label="Video" href={media.videoHref} name={media.videoName} bytes={media.videoBytes} />
                </ol>
                <button
                  className="s2-btn s2-btn--red s2-btn--big"
                  type="button"
                  disabled={busy !== null || drafts.length === 0}
                  onClick={() => run("publish", () => post(`/api/books/${book.id}/publish`).then(() => undefined))}
                >
                  {busy === "publish" ? "Publishing…" : drafts.length ? (book.status === "PUBLISHED" ? "Publish the latest version" : "Publish") : "Make the book first"}
                </button>
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
  spend,
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
  spend: { usd: string; cap: string | null };
  bookId: string;
  actions: { approve: (id: string) => void; hide: (id: string) => void; show: (id: string) => void };
  onRun: () => void;
  onDone: () => void;
}) {
  const [filter, setFilter] = useState<"all" | VoiceState>("all");
  const total = voices.length;
  const flow = FLOW.map((step, index) => {
    const passed = voices.filter((voice) => flowIndex(voice) > index).length;
    const active = voices.filter((voice) => flowIndex(voice) === index && voice.status === "PROCESSING").length;
    const flagged = step.check ? voices.filter((voice) => voice.checks && voice.checks[step.check!] !== undefined && voice.checks[step.check!] !== !step.bad).length : 0;
    return { ...step, passed, active, flagged };
  });
  const list = [...voices].reverse().filter((voice) => filter === "all" || states.get(voice.id) === filter);
  const maxGroup = Math.max(1, ...groups.map((group) => group.count));
  const stats: [string, number, string, VoiceState | "all"][] = [
    ["Heard", counts.heard, "", "all"],
    ["Approved", counts.approved, "ok", "approved"],
    ["Need you", counts.needs, counts.needs ? "red" : "", "needs"],
    ["Not used", counts.notUsed, "", "notused"],
    ["Hidden", counts.hidden, "", "hidden"],
  ];

  return (
    <section className="s2-tab">
      <div className="s2-head">
        <div>
          <h1>AI at work</h1>
          <p>Every voice is checked automatically. You only decide the unsure ones.</p>
        </div>
        <div className="s2-head__act">
          <span className="s2-writer s2-writer--head">{writerLine}</span>
          <button className="s2-btn s2-btn--red" type="button" disabled={busy !== null} onClick={onRun}>
            {busy === "tick" ? "Running…" : "Run AI now"}
          </button>
        </div>
      </div>

      <div className="s2-stats" role="list">
        {stats.map(([label, value, tone, key]) => (
          <button
            key={label}
            role="listitem"
            type="button"
            className={`s2-stat ${tone}${filter === key ? " on" : ""}`}
            onClick={() => setFilter(key)}
            aria-label={`${value} ${label}`}
          >
            <b>{value}</b>
            <span>{label}</span>
          </button>
        ))}
      </div>

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

      <div className="s2-cols">
        <div className="s2-stack">
          <div className={`s2-card s2-needs${needsYou.length ? " on" : ""}`}>
            <div className="s2-card__head">
              <h3>Needs you</h3>
              <span className="s2-count">{needsYou.length}</span>
            </div>
            {needsYou.length === 0 ? (
              <p className="s2-clear">
                <i>
                  <Tick />
                </i>{" "}
                All clear. Nothing is waiting for you.
              </p>
            ) : (
              <ul className="s2-needs__list">
                {needsYou.map((voice) => (
                  <li key={voice.id}>
                    <div>
                      <b>{voice.name}</b>
                      <q>{snippet(voice.englishText || voice.originalText, 160) || "No words heard."}</q>
                      <span className="s2-why">{voice.rejectReason || (voice.impersonation ? "Uses a public figure's name." : "The AI was not sure.")}</span>
                    </div>
                    <span className="s2-row">
                      {voice.status !== "FAILED" ? (
                        <button className="s2-btn s2-btn--sm s2-btn--red" type="button" disabled={busy !== null} onClick={() => actions.approve(voice.id)}>
                          Use it
                        </button>
                      ) : null}
                      <button className="s2-btn s2-btn--sm s2-btn--ghost" type="button" disabled={busy !== null} onClick={() => actions.hide(voice.id)}>
                        Hide
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="s2-card">
            <div className="s2-card__head">
              <h3>
                <span className="s2-live" aria-hidden /> Live
              </h3>
              <div className="s2-chips" role="tablist" aria-label="Filter voices">
                {(["all", "needs", "approved", "notused", "hidden"] as const).map((key) => (
                  <button key={key} type="button" role="tab" aria-selected={filter === key} className={filter === key ? "on" : ""} onClick={() => setFilter(key)}>
                    {key === "all" ? "All" : STATE_LABEL[key]}
                  </button>
                ))}
              </div>
            </div>
            {list.length === 0 ? (
              <p className="s2-muted">{total === 0 ? "No voices yet. They show up here the moment someone speaks." : "Nothing here."}</p>
            ) : (
              <ul className="s2-voices">
                {list.slice(0, 12).map((voice) => {
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
                      <span className={`s2-state s2-state--${state}`}>{state === "working" ? `${STATE_LABEL[state]} · ${FLOW[Math.min(7, flowIndex(voice))].label}` : STATE_LABEL[state]}</span>
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
            {list.length > 12 ? <p className="s2-fine">Showing the newest 12 of {list.length}.</p> : null}
          </div>
        </div>

        <div className="s2-stack">
          <div className="s2-card">
            <div className="s2-card__head">
              <h3>Matching voices</h3>
              <span className="s2-muted">grouped by AI</span>
            </div>
            {groups.length === 0 ? (
              <p className="s2-muted">Groups appear once voices are in.</p>
            ) : (
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
            )}
          </div>
          <Spend spend={spend} writer={null} compact />
          <details className="s2-card s2-more">
            <summary>
              <h3>Add replies from X</h3>
              <span className="s2-muted">same checks</span>
            </summary>
            <XReplies bookId={bookId} onDone={onDone} />
          </details>
        </div>
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

function CopyButton({ text }: { text: string | (() => string) }) {
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
      {done ? "Copied" : "Copy"}
    </button>
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
            "MP4, made from the book"
          ) : (
            "MP3 or WAV, read from the book"
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

function Spend({ spend, writer, compact = false }: { spend: { usd: string; cap: string | null }; writer: string | null; compact?: boolean }) {
  const cap = spend.cap ?? "no cap";
  const capUsd = Number(cap.replace(/[^0-9.]/g, "")) || 0;
  const usedUsd = Number(spend.usd.replace(/[^0-9.]/g, "")) || 0;
  const share = capUsd ? Math.min(1, usedUsd / capUsd) : 0;
  return (
    <div className={`s2-card s2-spend${compact ? " compact" : ""}`}>
      <div className="s2-card__head">
        <h3>AI spend</h3>
        <span className="s2-muted">{cap === "no cap" ? "no cap set" : `stops at ${cap}`}</span>
      </div>
      <p className="s2-spend__n">
        <b>{spend.usd === "$0.00" ? "<$0.01" : spend.usd}</b>
        {capUsd ? <span> of {cap}</span> : null}
      </p>
      <div className="s2-spend__bar" aria-hidden>
        <i style={{ width: `${Math.max(1, share * 100)}%` }} />
      </div>
      {!compact ? (
        <p className="s2-fine">{writer ? `Writing with ${writer}. ` : ""}Models on this computer are free. The AI can&apos;t go over the cap.</p>
      ) : null}
    </div>
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
    ["s-voices", "Voices"],
    ["s-ai", "AI models"],
    ["s-poll", "Next book poll"],
    ...(book.type === "INVITED" ? ([["s-invite", "Invite link"]] as [string, string][]) : []),
    ...(book.type === "FAMOUS" ? ([["s-quotes", "Famous quotes"]] as [string, string][]) : []),
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
          <p>Everything about this book in one place.</p>
        </div>
      </div>
      {message ? <p className="s2-alert">{message}</p> : null}
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
                <span>Picked first on the speak page</span>
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

          <section className="s2-card" id="s-ai">
            <div className="s2-card__head">
              <h3>AI models</h3>
              <span className="s2-chip">shared by all your books</span>
            </div>
            <div className="s2-aisum">
              <div>
                <span>Writer</span>
                <b>{ai.writer ?? "Demo mode"}</b>
              </div>
              <div>
                <span>Transcription</span>
                <b>{ai.hearer ?? "Browser speech-to-text"}</b>
              </div>
            </div>
            <AiModels initial={providers} mockServer={settings.mockServer} onChange={onDone} />
            <div className="s2-sub">
              <h4>Run a Meta model on this computer</h4>
              <p className="s2-fine">Free and private. One click downloads Llama and plugs it into the pipeline.</p>
              <LocalModels onChange={onDone} />
            </div>
            <div className="s2-setrow">
              <div>
                <b>Pause the AI for this book</b>
                <span>{pausedAi ? "Paused. New voices save and wait." : "On. Voices are checked as they come in."}</span>
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
            <details className="s2-legacy">
              <summary>Book-only Meta key {settings.hasAiKey ? "· saved" : ""}</summary>
              <p className="s2-fine">Used by this book only, when no model above works. Encrypted on the server and never shown again.</p>
              {settings.hasAiKey ? (
                <div className="s2-setrow">
                  <b>Key saved · encrypted</b>
                  <button className="s2-btn s2-btn--sm s2-btn--ghost" type="button" onClick={() => void save({ clearAiKey: true })}>
                    Remove key
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
                    placeholder={settings.hasAiKey ? "Paste a new key to replace it" : "Paste a Meta key"}
                    value={aiKey}
                    onChange={(event) => setAiKey(event.target.value)}
                  />
                  <button className="s2-btn s2-btn--sm" type="submit" disabled={!aiKey.trim()}>
                    Save key
                  </button>
                </form>
              ) : null}
            </details>
          </section>

          <section className="s2-card" id="s-poll">
            <div className="s2-card__head">
              <h3>Next book poll</h3>
              {saveButton(dirtyPoll, () => void save({ pollQuestion: book.pollQuestion, pollOptions: poll.map((line) => line.trim()).filter(Boolean) }))}
            </div>
            <p className="s2-fine">Readers vote on what the next book asks. Shown after release.</p>
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

          <section className="s2-card s2-danger" id="s-data">
            <div className="s2-card__head">
              <h3>Data</h3>
              <span className="s2-muted">a backup is saved before each</span>
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
