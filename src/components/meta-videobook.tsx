"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Option = { value: string; model: string; provider: string; recommended: boolean; usable: boolean; note?: string };
type Voice = { id: string; label: string; recommended: boolean };
type Progress = {
  status: "none" | "running" | "busy" | "assemble" | "ready" | "failed";
  phase: string;
  percent: number;
  narration: { ready: boolean; percent: number };
  boards: { done: number; total: number; plain: number };
  pictures: { done: number; total: number; failed: number };
  error?: string;
};
type Video = { key: string; bytes: number; ms: number; writer: string; image: string; voice: string; pictures: number; madeAt: string; codec: string };
type Panel = {
  metaOnly: boolean;
  lang: string;
  langName: string;
  writers: Option[];
  writerPicked: string;
  images: Option[];
  imagePicked: string;
  voices: Voice[];
  voicePicked: string;
  narration: { ms: number; writer: string; voice: string } | null;
  progress: Progress;
  video: Video | null;
  pictureNotes: number;
  estimate: { minutes: number; pictures: number; usd: number; makeMinutes: number };
  runsLeftToday: number;
  error?: string;
};

const clock = (ms: number) => {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Release tab: make the video book with Meta models (scenes, pictures, voice), pick the model for each step, and follow the progress. */
export function MetaVideobook({ bookId, slug }: { bookId: string; slug: string }) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [film, setFilm] = useState<{ percent: number; note: string } | null>(null);
  const [changed, setChanged] = useState(false);
  const driving = useRef(false);
  const alive = useRef(true);
  const made = useRef<{ hash: string; bytes: Uint8Array; codec: string } | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/books/${bookId}/media/meta/video`, { cache: "no-store" }).catch(() => null);
    const data = (await response?.json().catch(() => null)) as Panel | null;
    if (!response?.ok || !data) {
      setError(data?.error ?? "Could not load the video book settings.");
      return null;
    }
    setPanel(data);
    setProgress(data.progress);
    return data;
  }, [bookId]);

  /** The browser half: draw and encode the film, then upload it in parts. */
  const assemble = useCallback(async () => {
    const client = await import("@/lib/media/meta/film-client");
    if (!client.canMakeFilm()) throw new Error("This browser can't put a film together. Use a recent Chrome or Edge on a computer.");
    const response = await fetch(`/api/books/${bookId}/media/meta/video?plan=1`, { cache: "no-store" });
    const plan = await response.json().catch(() => null);
    if (!response.ok || !plan) throw new Error(plan?.error ?? "Could not load the film plan.");
    let result = made.current?.hash === `${plan.hash}:${plan.uploadId}` ? made.current : null;
    if (!result) {
      const rendered = await client.renderFilm(plan, (p) => {
        if (alive.current) setFilm({ percent: p.stage === "load" ? Math.round(p.percent * 0.05) : 5 + Math.round(p.percent * 0.85), note: p.note });
      });
      result = { hash: `${plan.hash}:${plan.uploadId}`, ...rendered };
      made.current = result;
    }
    await client.uploadFilm(bookId, plan, result, (p) => {
      if (alive.current) setFilm({ percent: 90 + Math.round(p.percent * 0.1), note: p.note });
    });
    made.current = null;
  }, [bookId]);

  const drive = useCallback(async () => {
    if (driving.current) return;
    driving.current = true;
    try {
      for (let round = 0; round < 400 && alive.current; round += 1) {
        const response = await fetch(`/api/books/${bookId}/media/meta/video`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "step" }),
        }).catch(() => null);
        const data = (await response?.json().catch(() => null)) as (Progress & { error?: string }) | null;
        if (!response || !data) {
          await wait(5000);
          continue;
        }
        if (!response.ok) {
          setError(data.error ?? "The video book stopped.");
          break;
        }
        setProgress(data);
        if (data.status === "assemble") {
          try {
            setFilm({ percent: 0, note: "Getting the film ready" });
            await assemble();
          } catch (problem) {
            setError(`${problem instanceof Error ? problem.message : "The film could not be put together"}. Nothing is lost: press Finish the film to try again.`);
          } finally {
            setFilm(null);
          }
          break;
        }
        if (data.status === "ready" || data.status === "failed" || data.status === "none") break;
        if (data.status === "busy") await wait(5000);
      }
    } finally {
      driving.current = false;
      if (alive.current) {
        await load();
        router.refresh();
      }
    }
  }, [bookId, load, router, assemble]);

  useEffect(() => {
    alive.current = true;
    const timer = window.setTimeout(() => {
      void load().then((data) => {
        // A run left half done (tab closed, network gone) carries on by itself, including the film itself.
        if (data && ["running", "busy", "assemble"].includes(data.progress.status)) void drive();
      });
    }, 0);
    return () => {
      alive.current = false;
      window.clearTimeout(timer);
    };
  }, [load, drive]);

  async function save(body: { writer?: string; images?: string; voice?: string }) {
    setError("");
    const response = await fetch(`/api/books/${bookId}/media/meta/video`, {
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
    setChanged(Boolean(data.video));
  }

  async function start() {
    setError("");
    setChanged(false);
    const response = await fetch(`/api/books/${bookId}/media/meta/video`, {
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
    if (data.status === "running" || data.status === "assemble") void drive();
    else await load();
  }

  if (!panel) {
    return (
      <div className="s5-meta" data-testid="meta-video">
        <div className="s5-meta__head">
          <b>Video book with Meta</b>
          <span>{error || "Loading…"}</span>
        </div>
      </div>
    );
  }

  const running = Boolean(film) || progress?.status === "running" || progress?.status === "busy";
  const assembling = progress?.status === "assemble";
  const writerValue = panel.writerPicked || panel.writers.find((w) => w.recommended)?.value || "";
  const imageValue = panel.imagePicked || panel.images.find((w) => w.recommended)?.value || "none";
  const noWriter = panel.writers.length === 0;
  const percent = film ? 80 + Math.round(film.percent * 0.2) : (progress?.percent ?? 0);
  const phase = film ? film.note : progress?.phase || "Working";
  const many = (list: Option[]) => list.some((o) => o.provider !== list[0]?.provider && o.value !== "none");

  return (
    <div className="s5-meta" data-testid="meta-video">
      <div className="s5-meta__head">
        <b>Video book with Meta</b>
        <span>Muse Spark plans the scenes · Muse Image draws them · the Meta voice narrates</span>
      </div>

      <div className="s5-meta__picks">
        <label className="s5-meta__pick">
          Scene writer
          <select value={writerValue} disabled={running || noWriter} onChange={(event) => void save({ writer: event.target.value })} data-testid="meta-video-writer">
            {noWriter ? <option value="">No Meta key yet: simple scenes</option> : null}
            {panel.writers.map((option) => (
              <option key={option.value} value={option.value} disabled={!option.usable}>
                {option.model}
                {option.recommended ? " · Recommended" : ""}
                {many(panel.writers) ? ` · ${option.provider}` : ""}
                {option.note ? ` (${option.note})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="s5-meta__pick">
          Pictures
          <select value={imageValue} disabled={running} onChange={(event) => void save({ images: event.target.value })} data-testid="meta-video-images">
            {panel.images.map((option) => (
              <option key={option.value} value={option.value} disabled={!option.usable}>
                {option.model}
                {option.recommended ? " · Recommended" : ""}
                {option.note ? ` (${option.note})` : ""}
              </option>
            ))}
          </select>
          <small>Meta has no video model yet, so the film moves over still pictures.</small>
        </label>
        <label className="s5-meta__pick">
          Voice · {panel.langName}
          <select
            value={panel.voicePicked || panel.voices.find((v) => v.recommended)?.id || ""}
            disabled={running || panel.voices.length === 0}
            onChange={(event) => void save({ voice: event.target.value })}
            data-testid="meta-video-voice"
          >
            {panel.voices.length === 0 ? <option value="">No Meta voice for {panel.langName} yet</option> : null}
            {panel.voices.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.label}
                {voice.recommended ? " · Recommended" : ""}
              </option>
            ))}
          </select>
          <small>{panel.narration ? `Uses the audiobook narration (${clock(panel.narration.ms)}).` : "Records the audiobook narration first."} Same voice as the audiobook.</small>
        </label>
      </div>

      {!running && !assembling ? (
        <p className="s5-meta__est">
          About {panel.estimate.minutes} min of film{panel.estimate.pictures ? ` · up to ${panel.estimate.pictures} pictures` : ""} ·{" "}
          {panel.estimate.usd < 0.01 ? "less than $0.01" : `about $${panel.estimate.usd.toFixed(2)}`} of Meta usage on your key · takes about {panel.estimate.makeMinutes} min, keep this tab open ·{" "}
          {panel.runsLeftToday} {panel.runsLeftToday === 1 ? "run" : "runs"} left today
        </p>
      ) : null}

      {progress && (running || (progress.status !== "none" && progress.status !== "ready")) ? (
        <div aria-live="polite">
          <div className={`s5-meta__status${progress.status === "failed" && !film ? " s5-meta__status--failed" : ""}`}>
            <span>{progress.status === "failed" && !film ? progress.error || "The video book stopped." : phase}</span>
            <span>{progress.status === "failed" && !film ? "" : `${percent}%`}</span>
          </div>
          {progress.status !== "failed" || film ? (
            <div className="s5-meta__bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
              <i style={{ width: `${percent}%` }} />
            </div>
          ) : null}
          {running ? <small className="s5-meta__est">Keep this tab open while the film is put together. If it closes, open Release again and it carries on.</small> : null}
        </div>
      ) : null}

      {panel.video ? (
        <div className="s5-meta__done" data-testid="meta-video-done">
          <span>
            {panel.langName} · {clock(panel.video.ms)} · {panel.video.pictures ? `${panel.video.pictures} pictures` : "styled cards"}
          </span>
          <video controls preload="metadata" src={`/api/media/${slug}/video?v=${panel.video.bytes}`} />
          <small>
            Scenes: {panel.video.writer.split(" · ")[0]}
            {panel.video.pictures ? ` · Pictures: ${panel.video.image.split(" · ")[0]}` : ""} · Voice: {panel.video.voice.split(" · ")[0]}
            {panel.pictureNotes ? ` · ${panel.pictureNotes} scene(s) used a styled card` : ""}
          </small>
        </div>
      ) : null}

      {error ? (
        <span className="s2-err" role="alert">
          {error}
        </span>
      ) : null}

      <div className="s5-meta__row">
        <button
          className="s2-btn s2-btn--sm s2-btn--red"
          type="button"
          disabled={running || (!assembling && panel.runsLeftToday <= 0)}
          onClick={() => (assembling ? void drive() : void start())}
          data-testid="meta-video-make"
        >
          {running ? "Making…" : assembling ? "Finish the film" : progress?.status === "failed" ? "Try again" : panel.video ? "Make again" : "Make video book"}
        </button>
        {changed && !running ? <small className="s5-meta__est">Saved. Press Make again to use it; only the changed steps run again.</small> : null}
      </div>
    </div>
  );
}
