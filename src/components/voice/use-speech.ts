"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MODEL_MB_ESTIMATE, VoiceEngine, isPhone, modelCached, voiceSupport, type ChunkStat, type LoadStage, type ModelInfo } from "./voice-engine";

/** What the person sees: Downloading → Getting ready → Listening (and Writing your words) → Done. */
export type SpeechPhase = "checking" | "off" | "idle" | "downloading" | "preparing" | "listening" | "finishing";
export type SpeechProblem = "" | "mic" | "nomic" | "micother" | "model" | "slow" | "unsupported";
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
  /** Listening, and nothing heard yet in this take: the page says "Start speaking". */
  const [fresh, setFresh] = useState(false);
  const preloading = useRef(false);
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

  // Seconds spent getting ready, shown next to the label so a slow start never looks frozen.
  const [prepSec, setPrepSec] = useState(0);
  useEffect(() => {
    if (phase !== "preparing") return;
    const began = Date.now();
    const reset = setTimeout(() => setPrepSec(0), 0);
    const timer = setInterval(() => setPrepSec(Math.floor((Date.now() - began) / 1000)), 1000);
    return () => {
      clearTimeout(reset);
      clearInterval(timer);
    };
  }, [phase]);

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

  const handlers = useCallback(
    () => ({
      onProgress: (loaded: number, total: number) => setProgress({ loaded, total }),
      onStatus: (next: LoadStage, _device: string, error?: string) => {
        setStage(next);
        if (next === "loading" || next === "warming") setPhase((now) => (now === "downloading" ? "preparing" : now));
        if (error) setDetail(error);
      },
      onLevel: setLevel,
      onSpeaking: (on: boolean) => {
        setSpeaking(on);
        if (on) setFresh(false);
      },
      onText: (text: string) => {
        words.current += 1;
        setFresh(false);
        insertRef.current(text);
      },
      onPending: setPending,
      onChunk: (stat: ChunkStat) => setChunks((list) => [...list, stat].slice(-30)),
      onError: (message: string) => {
        setDetail(message);
        if (/too long/i.test(message)) setProblem("slow");
      },
    }),
    [],
  );

  /**
   * Get the model ready before the tap (the Speak tab is showing): download if needed, load, and warm
   * up with a real phrase. The mic stays off and its button waits until the model is truly ready.
   */
  const preload = useCallback(async () => {
    const live = engine.current;
    if (!live || live.isReady || preloading.current || phaseRef.current !== "idle") return;
    preloading.current = true;
    live.setHandlers(handlers());
    setProblem("");
    setDetail("");
    setProgress({ loaded: 0, total: 0 });
    setStage(cached ? "loading" : "downloading");
    setPhase(cached ? "preparing" : "downloading");
    try {
      const loaded = await live.loadModel();
      setInfo(loaded);
      setCached(true);
      const now = phaseRef.current as SpeechPhase;
      if (now === "downloading" || now === "preparing") {
        setPhase("idle");
      }
    } catch (error) {
      setDetail(String((error as Error)?.message || error));
      setProblem("model");
      setPhase("idle");
    } finally {
      preloading.current = false;
    }
  }, [cached, handlers]);

  /** Call straight from the tap: the browser only allows the mic and audio inside it. */
  const toggle = useCallback(async () => {
    const live = engine.current;
    if (!live) {
      // This browser can't run the voice model: say so kindly and offer Write.
      if (phaseRef.current === "off") setProblem("unsupported");
      return;
    }
    if (phaseRef.current === "listening") {
      await stop();
      return;
    }
    if (phaseRef.current !== "idle") return;
    setProblem("");
    setNote("");
    setDetail("");
    live.setHandlers(handlers());
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
    if (!live.isReady) {
      // Not ready yet (the model was not loaded before the tap): the page says "please wait", and
      // anything said meanwhile is kept and written once the model is ready, so no words are lost.
      setProgress({ loaded: 0, total: 0 });
      setStage(cached ? "loading" : "downloading");
      setPhase(cached ? "preparing" : "downloading");
      startedAt.current = 0;
      let recording: Promise<void> | null = null;
      void audio.then(() => {
        if (tries.current !== attempt) return;
        recording = live.record().then(() => {
          startedAt.current = Date.now();
        });
        recording.catch(() => {});
      }, () => {});
      try {
        const loaded = await live.loadModel();
        setInfo(loaded);
        setCached(true);
        if (tries.current !== attempt) return;
      } catch (error) {
        if (tries.current !== attempt) return;
        live.abort();
        live.dropHeld();
        setDetail(String((error as Error)?.message || error));
        setProblem("model");
        setPhase("idle");
        return;
      }
      try {
        await audio;
        if (tries.current !== attempt) return;
        if (!recording) recording = live.record();
        await recording;
        if (!startedAt.current) startedAt.current = Date.now();
        setElapsed(0);
        setFresh(words.current === 0 || !live.sent);
        setPhase("listening");
      } catch (error) {
        if (tries.current !== attempt) return;
        tries.current += 1;
        live.abort();
        micProblem(error);
        setPhase("idle");
      }
      return;
    }
    // Ready: listening starts at once.
    try {
      await audio;
      if (tries.current !== attempt) return;
      await live.record();
      startedAt.current = Date.now();
      setElapsed(0);
      setFresh(true);
      setPhase("listening");
    } catch (error) {
      if (tries.current !== attempt) return;
      tries.current += 1;
      live.abort();
      micProblem(error);
      setPhase("idle");
    }
  }, [cached, stop, handlers]);

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
    fresh,
    problem,
    note,
    detail,
    info,
    chunks,
    elapsed,
    spokenMs,
    prepSec,
    diagnostics: () => engine.current?.diagnostics() ?? null,
    supported: phase !== "off" && phase !== "checking",
    checking: phase === "checking",
    toggle,
    preload,
    stop,
    setLanguage,
    clearNote: () => setNote(""),
  };
}
