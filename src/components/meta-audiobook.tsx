"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Option = { value: string; model: string; provider: string; recommended: boolean; usable: boolean; note?: string };
type Voice = { id: string; label: string; recommended: boolean };
type Progress = {
  status: "none" | "running" | "ready" | "failed" | "busy";
  phase: string;
  percent: number;
  scripts: { done: number; total: number };
  voice: { done: number; total: number };
  plainUnits: number;
  error?: string;
  skipped: { lang: string; reason: string }[];
};
type Audio = { key: string; bytes: number; ms: number; chapters: { title: string; startMs: number }[]; writer: string; voice: string; plainUnits: number; madeAt: string };
type Panel = {
  metaOnly: boolean;
  writers: Option[];
  writerPicked: string;
  languages: { lang: string; name: string; voices: Voice[]; picked: string }[];
  waiting: { lang: string; reason: string }[];
  progress: Progress;
  audio: Record<string, Audio>;
  estimate: { units: number; minutes: number; usd: number };
  runsLeftToday: number;
  error?: string;
};

const minutes = (ms: number) => {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/** Release tab: make the audiobook with Meta models, pick the model for each step, and follow the progress. */
export function MetaAudiobook({ bookId, slug, locked = false }: { bookId: string; slug: string; locked?: boolean }) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [changed, setChanged] = useState(false);
  const driving = useRef(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    const response = await fetch(`/api/books/${bookId}/media/meta`, { cache: "no-store" }).catch(() => null);
    const data = (await response?.json().catch(() => null)) as Panel | null;
    if (!response?.ok || !data) {
      setError(data?.error ?? "Could not load the audiobook settings.");
      return null;
    }
    setPanel(data);
    setProgress(data.progress);
    return data;
  }, [bookId]);

  const drive = useCallback(async () => {
    if (driving.current) return;
    driving.current = true;
    try {
      for (let round = 0; round < 400 && alive.current; round += 1) {
        const response = await fetch(`/api/books/${bookId}/media/meta`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "step" }),
        }).catch(() => null);
        const data = (await response?.json().catch(() => null)) as (Progress & { error?: string }) | null;
        if (!response || !data) {
          // Network blip: wait and carry on; the work is saved on the server.
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }
        if (!response.ok) {
          setError(data.error ?? "The audiobook stopped.");
          break;
        }
        setProgress(data);
        if (data.status === "ready" || data.status === "failed" || data.status === "none") break;
        if (data.status === "busy") await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    } finally {
      driving.current = false;
      if (alive.current) {
        await load();
        router.refresh();
      }
    }
  }, [bookId, load, router]);

  useEffect(() => {
    alive.current = true;
    const timer = window.setTimeout(() => {
      void load().then((data) => {
        // A run left half done (tab closed, network gone) carries on by itself.
        if (!locked && (data?.progress.status === "running" || data?.progress.status === "busy")) void drive();
      });
    }, 0);
    return () => {
      alive.current = false;
      window.clearTimeout(timer);
    };
  }, [load, drive, locked]);

  async function save(body: { writer?: string; voices?: Record<string, string> }) {
    setError("");
    const response = await fetch(`/api/books/${bookId}/media/meta`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => null)) as Panel | null;
    if (!response.ok || !data) {
      setError(data?.error ?? "Could not save.");
      return;
    }
    setPanel(data);
    setChanged(Object.keys(data.audio).length > 0);
  }

  async function start() {
    setError("");
    setChanged(false);
    const response = await fetch(`/api/books/${bookId}/media/meta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    });
    const data = (await response.json().catch(() => null)) as (Progress & { error?: string }) | null;
    if (!response.ok || !data) {
      setError(data?.error ?? "Could not start.");
      return;
    }
    setProgress(data);
    if (data.status === "running") void drive();
    else await load();
  }

  if (!panel) {
    return (
      <div className={`s5-meta${locked ? " s5-meta--locked" : ""}`} data-testid="meta-audiobook">
        <div className="s5-meta__head">
          <b>Audiobook with Meta</b>
          <span>{error || "Loading…"}</span>
        </div>
      </div>
    );
  }

  const running = !locked && (progress?.status === "running" || progress?.status === "busy");
  const writerValue = panel.writerPicked || panel.writers.find((w) => w.recommended)?.value || "";
  const made = panel.languages.filter((l) => panel.audio[l.lang]);
  const noWriter = panel.writers.length === 0;

  return (
    <div className={`s5-meta${locked ? " s5-meta--locked" : ""}`} data-testid="meta-audiobook">
      <div className="s5-meta__head">
        <b>Audiobook with Meta</b>
        <span>Muse Spark writes the narration · Meta MMS-TTS reads it</span>
      </div>
      {locked ? (
        <p className="s5-meta__lock" data-testid="meta-audiobook-locked">
          Unlocks after Publish. These are the models it will use.
        </p>
      ) : null}

      <div className="s5-meta__picks">
        <label className="s5-meta__pick">
          Script writer
          <select
            value={writerValue}
            disabled={locked || running || noWriter}
            onChange={(event) => void save({ writer: event.target.value })}
            data-testid="meta-writer"
          >
            {noWriter ? <option value="">No Meta key yet: plain script</option> : null}
            {panel.writers.map((option) => (
              <option key={option.value} value={option.value} disabled={!option.usable}>
                {option.model}
                {option.recommended ? " · Recommended" : ""}
                {panel.writers.some((w) => w.provider !== option.provider) ? ` · ${option.provider}` : ""}
                {option.note ? ` (${option.note})` : ""}
              </option>
            ))}
          </select>
          {noWriter ? <small>Add your Meta key in Settings → AI model to let Muse Spark write the narration.</small> : null}
        </label>
        {panel.languages.map((language) => (
          <label className="s5-meta__pick" key={language.lang}>
            Voice · {language.name}
            <select
              value={language.picked || language.voices.find((v) => v.recommended)?.id || ""}
              disabled={locked || running || language.voices.length === 0}
              onChange={(event) => void save({ voices: { [language.lang]: event.target.value } })}
              data-testid={`meta-voice-${language.lang}`}
            >
              {language.voices.length === 0 ? <option value="">No Meta voice for {language.name} yet</option> : null}
              {language.voices.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.label}
                  {voice.recommended ? " · Recommended" : ""}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {!running && !locked ? (
        <p className="s5-meta__est">
          About {Math.max(1, panel.estimate.minutes)} min of listening · {panel.estimate.usd < 0.01 ? "less than $0.01" : `about $${panel.estimate.usd.toFixed(2)}`} of Meta usage on your key ·{" "}
          {panel.runsLeftToday} {panel.runsLeftToday === 1 ? "run" : "runs"} left today
          {panel.waiting.length ? ` · Waiting: ${panel.waiting.map((w) => `${w.lang.toUpperCase()} (${w.reason.toLowerCase()})`).join(", ")}` : ""}
        </p>
      ) : null}

      {!locked && progress && progress.status !== "none" && progress.status !== "ready" ? (
        <div aria-live="polite">
          <div className={`s5-meta__status${progress.status === "failed" ? " s5-meta__status--failed" : ""}`}>
            <span>{progress.status === "failed" ? progress.error || "The audiobook stopped." : progress.phase || "Working"}</span>
            <span>{progress.status === "failed" ? "" : `${progress.percent}%`}</span>
          </div>
          {progress.status !== "failed" ? (
            <div className="s5-meta__bar" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}>
              <i style={{ width: `${progress.percent}%` }} />
            </div>
          ) : null}
        </div>
      ) : null}

      {made.map((language) => {
        const audio = panel.audio[language.lang];
        return (
          <div className="s5-meta__done" key={language.lang} data-testid={`meta-audio-${language.lang}`}>
            <span>
              {language.name} · {minutes(audio.ms)} · {audio.chapters.length} parts
            </span>
            <audio controls preload="metadata" src={`/api/media/${slug}/audiobook?lang=${language.lang}&v=${audio.bytes}`} />
            <small>
              Words: {audio.writer.split(" · ")[0]} · Voice: {audio.voice}
              {audio.plainUnits ? ` · ${audio.plainUnits} part(s) used the plain script` : ""}
            </small>
          </div>
        );
      })}

      {error ? (
        <span className="s2-err" role="alert">
          {error}
        </span>
      ) : null}

      <div className="s5-meta__row">
        <button
          className="s2-btn s2-btn--sm s2-btn--red"
          type="button"
          disabled={locked || running || panel.runsLeftToday <= 0}
          onClick={() => void start()}
          data-testid="meta-make"
        >
          {locked ? "Unlocks after Publish" : running ? "Making…" : progress?.status === "failed" ? "Try again" : made.length ? "Make again" : "Make audiobook"}
        </button>
        {changed && !running ? <small className="s5-meta__est">Saved. Press Make again to use it; only the changed steps run again.</small> : null}
      </div>
    </div>
  );
}
