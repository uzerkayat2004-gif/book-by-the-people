"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MODEL_MB_ESTIMATE, VoiceEngine, isPhone, modelCached, voiceSupport, type ChunkStat, type LoadStage, type ModelInfo } from "./voice-engine";

/** What the person sees: Downloading → Getting ready → Listening (and Writing your words) → Done. */
export type SpeechPhase = "checking" | "off" | "idle" | "downloading" | "preparing" | "listening" | "finishing";
export type SpeechProblem = "" | "mic" | "nomic" | "micother" | "model" | "slow";
export type SpeechNote = "" | "ready" | "done" | "nothing" | "nospeech" | "nowords" | "left";

/**
 * Speech to text in the browser for the Add your voice page.
 * `insert` gets each phrase as it is turned into words, in order.
 */
export function useSpeech(insert: (words: string) => void) {
  const [phase, setPhase] = useState<SpeechPhase>("checking");
  const [why, setWhy] = useState("");
  const [stage, setStage] = useState<LoadStage>("downloading");
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });
  const [cached, setCached] = useState<boolean | null>(null);
  const [level, setLevel] = useState(0);
  const [pending, setPending] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [problem, setProblem] = useState<SpeechProblem>("");
  /** Each tap is one attempt; a newer one (or a failure) makes older async steps stand down. */
  const tries = useRef(0);
  const [note, setNote] = useState<SpeechNote>("");
  const [detail, setDetail] = useState("");
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [chunks, setChunks] = useState<ChunkStat[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [spokenMs, setSpokenMs] = useState(0);
  const engine = useRef<VoiceEngine | null>(null);
  const startedAt = useRef(0);
  const insertRef = useRef(insert);
  const phaseRef = useRef(phase);
  const words = useRef(0);
  const languageRef = useRef("en");

  useEffect(() => {
    insertRef.current = insert;
  }, [insert]);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    let made: VoiceEngine | null = null;
    const id = setTimeout(() => {
      const support = voiceSupport();
      if (!support.ok) {
        setWhy(support.reason || "");
        setPhase("off");
        return;
      }
      // Cross-origin isolation (set by the page headers) lets the model use several threads.
      // A link that opened this page without a full load misses those headers: load it once more.
      const coiPossible = typeof HTMLIFrameElement !== "undefined" && "credentialless" in HTMLIFrameElement.prototype;
      const lastReload = Number(sessionStorage.getItem("bbtp:coi") || 0);
      if (!window.crossOriginIsolated && coiPossible && Date.now() - lastReload > 20_000) {
        sessionStorage.setItem("bbtp:coi", String(Date.now()));
        window.location.reload();
        return;
      }
      made = new VoiceEngine();
      const params = new URLSearchParams(window.location.search);
      // CPU (WebAssembly) works the same everywhere. The GPU path stays opt-in for testing.
      made.device = params.get("device") === "webgpu" ? "webgpu" : "wasm";
      const threads = Number(params.get("threads"));
      if (threads >= 1 && threads <= 8) made.threads = Math.floor(threads);
      else if (isPhone()) made.threads = window.crossOriginIsolated ? 2 : 1;
      made.language = languageRef.current;
      engine.current = made;
      setPhase("idle");
      void modelCached().then(setCached);
    }, 0);
    return () => {
      clearTimeout(id);
      made?.dispose();
    };
  }, []);

  const setLanguage = useCallback((code: string) => {
    languageRef.current = code;
    if (engine.current) engine.current.language = code;
  }, []);

  useEffect(() => {
    if (phase !== "listening") return;
    const timer = setInterval(() => setElapsed((Date.now() - startedAt.current) / 1000), 250);
    return () => clearInterval(timer);
  }, [phase]);

  const stop = useCallback(async (because: SpeechNote | "" = "") => {
    const live = engine.current;
    if (!live || phaseRef.current !== "listening") return;
    setPhase("finishing");
    setSpokenMs((ms) => ms + (Date.now() - startedAt.current));
    const before = words.current;
    await live.stop();
    setPhase("idle");
    setSpeaking(false);
    if (because) {
      setNote(because);
      return;
    }
    if (words.current === before) {
      if (live.maxRms < 0.004) setNote("nothing");
      else if (!live.sent) setNote("nospeech");
      else setNote("nowords");
    } else setNote("done");
  }, []);

  // Leaving the page (switching apps, locking the phone) stops cleanly and keeps what was said.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void stop("left");
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
  }, [stop]);

  /** Call straight from the tap: the browser only allows the mic and audio inside it. */
  const toggle = useCallback(async () => {
    const live = engine.current;
    if (!live) return;
    if (phaseRef.current === "listening") {
      await stop();
      return;
    }
    if (phaseRef.current !== "idle") return;
    setProblem("");
    setNote("");
    setDetail("");
    live.setHandlers({
      onProgress: (loaded, total) => setProgress({ loaded, total }),
      onStatus: (next, _device, error) => {
        setStage(next);
        if (next === "loading" || next === "warming") setPhase((now) => (now === "downloading" ? "preparing" : now));
        if (error) setDetail(error);
      },
      onLevel: setLevel,
      onSpeaking: setSpeaking,
      onText: (text) => {
        words.current += 1;
        insertRef.current(text);
      },
      onPending: setPending,
      onChunk: (stat) => setChunks((list) => [...list, stat].slice(-30)),
      onError: (message) => {
        setDetail(message);
        if (/too long/i.test(message)) setProblem("slow");
      },
    });
    const { audio } = live.begin();
    const attempt = ++tries.current;
    const micProblem = (error: unknown) => {
      const message = String((error as Error)?.name || "") + " " + String((error as Error)?.message || error);
      setDetail(message.trim());
      if (/NotAllowed|denied|Permission|Security/i.test(message)) setProblem("mic");
      else if (/NotFound|not found|Overconstrained/i.test(message)) setProblem("nomic");
      else setProblem("micother");
    };
    // A blocked mic shows at once, even while the model is still downloading (it keeps going for next time).
    audio.catch((error) => {
      if (tries.current !== attempt) return;
      tries.current += 1;
      live.abort();
      micProblem(error);
      setPhase("idle");
    });
    const first = !live.info;
    if (first) {
      setProgress({ loaded: 0, total: 0 });
      setStage(cached ? "loading" : "downloading");
      setPhase(cached ? "preparing" : "downloading");
    }
    let loaded: ModelInfo;
    try {
      loaded = await live.loadModel();
      setInfo(loaded);
      setCached(true);
      if (tries.current !== attempt) return;
    } catch (error) {
      if (tries.current !== attempt) return;
      live.abort();
      setDetail(String((error as Error)?.message || error));
      setProblem("model");
      setPhase("idle");
      return;
    }
    if (first && loaded.downloaded) {
      // A long first download: don't start listening behind the person's back.
      live.abort();
      setNote("ready");
      setPhase("idle");
      return;
    }
    try {
      await audio;
      if (tries.current !== attempt) return;
      await live.record();
      startedAt.current = Date.now();
      setElapsed(0);
      setPhase("listening");
    } catch (error) {
      if (tries.current !== attempt) return;
      tries.current += 1;
      live.abort();
      micProblem(error);
      setPhase("idle");
    }
  }, [cached, stop]);

  const expected = progress.total > 40e6 ? progress.total : Math.max(progress.total, MODEL_MB_ESTIMATE * 1e6);
  return {
    phase,
    why,
    stage,
    percent: Math.min(100, Math.round((progress.loaded / expected) * 100)),
    loadedMb: Math.round(progress.loaded / 1e6),
    totalMb: Math.round(expected / 1e6),
    cached,
    level,
    pending,
    speaking,
    problem,
    note,
    detail,
    info,
    chunks,
    elapsed,
    spokenMs,
    supported: phase !== "off" && phase !== "checking",
    checking: phase === "checking",
    toggle,
    stop,
    setLanguage,
    clearNote: () => setNote(""),
  };
}
