"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { COUNTRIES, flagEmoji } from "@/lib/countries";
import { LANGUAGES } from "@/lib/languages";
import { SPEAK_LANGUAGES } from "@/lib/speak-languages";
import { AGE_BANDS, regionsFor } from "@/lib/regions";
import { ClipQueue, cleanClipText, dropOverlap, joinPhrase } from "@/lib/speech/assemble";
import type { Clip } from "@/lib/speech/chunker";
import { canRecord, startRecorder, type LiveRecorder } from "@/lib/speech/recorder";
import { encodeWav, toInt16 } from "@/lib/speech/wav";
import { isAndroid, sessionText } from "@/lib/speech/web-speech";

/** Browser speech-to-text language for each language on the page. */
const SPEECH_LANG: Record<string, string> = {
  en: "en-US", hinglish: "en-IN", hi: "hi-IN", fr: "fr-FR", ar: "ar-SA", id: "id-ID", ms: "ms-MY", bn: "bn-IN",
  zh: "zh-CN", de: "de-DE", tr: "tr-TR", tl: "fil-PH", it: "it-IT", ja: "ja-JP", sw: "sw-KE", ko: "ko-KR",
  mr: "mr-IN", nl: "nl-NL", ne: "ne-NP", es: "es-ES", fa: "fa-IR", pl: "pl-PL", ru: "ru-RU", pt: "pt-BR",
  sv: "sv-SE", vi: "vi-VN", ta: "ta-IN", te: "te-IN", th: "th-TH", uk: "uk-UA", ur: "ur-PK",
};

type SpeechAlt = { transcript: string };
type SpeechResult = { isFinal: boolean; length: number; 0: SpeechAlt };
type SpeechResultEvent = { resultIndex: number; results: ArrayLike<SpeechResult> };
type SpeechRec = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};
type SpeechCtor = new () => SpeechRec;

function speechCtor(): SpeechCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}


const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

function IconMicBig() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}
function IconPen() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
    </svg>
  );
}
function IconStop() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />
    </svg>
  );
}

export function VoiceForm({
  bookId,
  slug,
  question,
  invite,
  paused,
  opens,
  closed,
  presetName = "",
  leftToday = 3,
  defaultLanguage = "en",
  maxSeconds = 600,
  cloudSpeech = false,
}: {
  bookId: string;
  slug: string;
  question: string;
  invite: string | null;
  paused: boolean;
  demo?: boolean;
  preview?: string | null;
  opens: string;
  closed?: boolean;
  surface?: "full" | "live";
  presetName?: string;
  presetWord?: string | null;
  leftToday?: number;
  defaultLanguage?: string;
  maxSeconds?: number;
  /** The book creator has a speech model, so clips are turned into words by it instead of the browser. */
  cloudSpeech?: boolean;
}) {
  const maxLong = maxSeconds % 60 === 0 ? `${maxSeconds / 60} min` : `${maxSeconds} sec`;
  // About 150 spoken words a minute, ~6 characters each, so the text limit matches the time limit.
  const maxChars = Math.min(9000, Math.max(600, Math.round((maxSeconds / 60) * 150 * 6)));
  const router = useRouter();
  const [mode, setMode] = useState<"speak" | "write">("write");
  /** "cloud" = the book creator's speech model hears short clips; "browser" = the browser's own speech-to-text. */
  const [engine, setEngine] = useState<"cloud" | "browser" | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [language, setLanguage] = useState(defaultLanguage);
  const [text, setText] = useState("");
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [starting, setStarting] = useState(false);
  const [pending, setPending] = useState(0);
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [name, setName] = useState(presetName);
  const [handle, setHandle] = useState("");
  const [ageBand, setAgeBand] = useState("");
  const [country, setCountry] = useState("IN");
  const [region, setRegion] = useState("");
  const [regionOther, setRegionOther] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [quiet, setQuiet] = useState(false);

  const textRef = useRef("");
  const listenStartRef = useRef(0);
  const listenedMsRef = useRef(0);
  const typedMsRef = useRef(0);
  const lastKeyRef = useRef(0);
  const keysRef = useRef(0);
  const spokenRef = useRef(0);
  const noteTimer = useRef<number | null>(null);
  // Cloud speech
  const recorderRef = useRef<LiveRecorder | null>(null);
  const queueRef = useRef(new ClipQueue());
  const seqRef = useRef(0);
  const pendingRef = useRef(0);
  const levelRef = useRef(0);
  const sessionRef = useRef("");
  const heardRef = useRef(false);
  // Browser speech
  const recRef = useRef<SpeechRec | null>(null);
  const wantRef = useRef(false);
  const baseRef = useRef("");
  const usedWordsRef = useRef(0);
  const shownWordsRef = useRef(0);
  const interimRef = useRef("");
  const restartsRef = useRef<number[]>([]);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  useEffect(() => {
    // Feature detection has to wait for the browser; this runs once after hydration.
    const next = cloudSpeech && canRecord() ? "cloud" : speechCtor() ? "browser" : null;
    queueMicrotask(() => {
      setEngine(next);
      setSupported(Boolean(next));
      if (!next) setMode("write");
    });
  }, [cloudSpeech]);

  const flash = useCallback((message: string, ms = 4000) => {
    setNote(message);
    if (noteTimer.current) window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote(null), ms);
  }, []);

  const putText = useCallback(
    (next: string) => {
      const clipped = next.length > maxChars ? next.slice(0, maxChars) : next;
      textRef.current = clipped;
      setText(clipped);
    },
    [maxChars],
  );

  /** Adds heard words at the end, after anything the person typed or fixed. */
  const addSpoken = useCallback(
    (phrase: string) => {
      const fresh = dropOverlap(textRef.current, phrase);
      if (!fresh) return;
      spokenRef.current += fresh.length;
      putText(joinPhrase(textRef.current, fresh));
    },
    [putText],
  );

  const endTimer = () => {
    if (listenStartRef.current) {
      listenedMsRef.current += Date.now() - listenStartRef.current;
      listenStartRef.current = 0;
    }
  };

  // ---------- Cloud: record clips, send each to the creator's speech model, add words in order ----------
  const settle = useCallback(
    (seq: number, words: string) => {
      for (const phrase of queueRef.current.settle(seq, words)) addSpoken(phrase);
    },
    [addSpoken],
  );

  const failRunRef = useRef(0);

  /** Something stopped the microphone path: say so next to the button, never leave a dead button. */
  const micFail = useCallback((message: string) => {
    setMicError(message);
  }, []);

  const sendClip = useCallback(
    async (clip: Clip) => {
      seqRef.current += 1;
      const seq = seqRef.current;
      pendingRef.current += 1;
      setPending(pendingRef.current);
      const wav = encodeWav(toInt16(clip.samples));
      const params = new URLSearchParams({ lang: language, session: sessionRef.current });
      if (invite) params.set("invite", invite);
      let words = "";
      let failed = false;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 50_000);
        let response: Response | null = null;
        let networkError = false;
        try {
          response = await fetch(`/api/books/${bookId}/transcribe?${params}`, {
            method: "POST",
            headers: { "Content-Type": "audio/wav" },
            body: new Blob([wav as BlobPart], { type: "audio/wav" }),
            signal: controller.signal,
          });
        } catch {
          networkError = !controller.signal.aborted;
        } finally {
          window.clearTimeout(timer);
        }
        const data = response ? await response.json().catch(() => ({})) : {};
        if (response?.ok) {
          words = cleanClipText(String(data.text ?? ""), clip.voicedMs);
          failRunRef.current = 0;
          break;
        }
        if (response && (data.code === "no-speech" || response.status === 409)) {
          // The book has no speech model (or it is paused): use the browser's own speech-to-text from now on.
          void recorderRef.current?.stop();
          recorderRef.current = null;
          endTimer();
          setListening(false);
          if (speechCtor()) {
            setEngine("browser");
            flash("Switched to your browser's speech-to-text. Tap to speak again.", 6000);
          } else {
            micFail("Speech-to-text isn't available for this book right now. Please switch to Write.");
          }
          break;
        }
        if (response && (response.status === 403 || response.status === 429 || response.status === 413)) {
          void recorderRef.current?.stop();
          recorderRef.current = null;
          endTimer();
          setListening(false);
          micFail(data.error ?? "That's the speaking limit. Edit your words, then add them.");
          break;
        }
        // Only a dropped connection is worth one quick retry; a slow or failed model is not.
        if (networkError && attempt === 0) continue;
        failed = true;
        break;
      }
      if (failed) {
        failRunRef.current += 1;
        if (failRunRef.current >= 2) {
          failRunRef.current = 0;
          void recorderRef.current?.stop();
          recorderRef.current = null;
          endTimer();
          setListening(false);
          if (speechCtor()) {
            setEngine("browser");
            micFail("Speech-to-text is having trouble right now, so we switched to your browser's own. Tap to speak again, or use Write.");
          } else {
            micFail("Speech-to-text is having trouble right now. Try again in a minute, or switch to Write.");
          }
        } else {
          flash("One part could not be turned into words. Keep going, or type it in.", 6000);
        }
      }
      settle(seq, words);
      pendingRef.current -= 1;
      setPending(pendingRef.current);
    },
    [bookId, flash, invite, language, micFail, settle],
  );

  const stopCloud = useCallback(async () => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    endTimer();
    setListening(false);
    setLevel(0);
    if (recorder) await recorder.stop();
  }, []);

  const startCloud = useCallback(async () => {
    if (!sessionRef.current) sessionRef.current = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    failRunRef.current = 0;
    heardRef.current = false;
    setStarting(true);
    try {
      // Called straight from the tap: the recorder makes its AudioContext before any await, so the browser lets it run.
      recorderRef.current = await startRecorder({
        onClip: (clip) => void sendClip(clip),
        onLevel: (value) => {
          levelRef.current = value;
          if (value > 0.01) heardRef.current = true;
        },
      });
      listenStartRef.current = Date.now();
      setListening(true);
    } catch (problem) {
      const name = problem instanceof DOMException || problem instanceof Error ? problem.name : "";
      micFail(
        name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError"
          ? "Microphone access is blocked. Allow the microphone for this site (the lock icon next to the address), then tap again, or switch to Write."
          : name === "NotFoundError" || name === "DevicesNotFoundError"
            ? "No microphone found. Plug one in, or switch to Write."
            : name === "NotReadableError"
              ? "Another app is using the microphone. Close it and tap again, or switch to Write."
              : "The microphone could not start. Tap to try again, or switch to Write.",
      );
    } finally {
      setStarting(false);
    }
  }, [micFail, sendClip]);

  // ---------- Browser: the browser's own speech-to-text, rebuilt per session so nothing repeats ----------
  const commitBrowser = useCallback(() => {
    const pendingWords = interimRef.current;
    if (pendingWords) addSpoken(pendingWords);
    interimRef.current = "";
    setInterim("");
  }, [addSpoken]);

  const stopBrowser = useCallback(() => {
    wantRef.current = false;
    const rec = recRef.current;
    recRef.current = null;
    endTimer();
    if (rec) {
      // Late results after Stop would repeat words already shown, so stop listening to them.
      rec.onresult = null;
      rec.onend = null;
      try {
        rec.stop();
      } catch {
        // already stopped
      }
    }
    commitBrowser();
    setListening(false);
  }, [commitBrowser]);

  const startSessionRef = useRef<() => void>(() => {});
  const startSession = useCallback(() => {
    const Ctor = speechCtor();
    if (!Ctor) return;
    const android = isAndroid(navigator.userAgent);
    const rec = new Ctor();
    // Android Chrome beeps and repeats itself in continuous mode, so it hears one stretch at a time.
    rec.continuous = !android;
    rec.interimResults = true;
    rec.lang = SPEECH_LANG[language] ?? language;
    baseRef.current = textRef.current;
    usedWordsRef.current = 0;
    shownWordsRef.current = 0;
    rec.onresult = (event) => {
      const heard = sessionText(event.results);
      const finalWords = heard.final.split(/\s+/).filter(Boolean);
      const freshWords = finalWords.slice(usedWordsRef.current);
      shownWordsRef.current = freshWords.length;
      const fresh = freshWords.join(" ");
      // Replace this session's words instead of appending, so cumulative results never repeat.
      const next = joinPhrase(baseRef.current, fresh);
      if (next !== textRef.current) {
        spokenRef.current = Math.max(spokenRef.current, next.length - baseRef.current.length);
        putText(next);
      }
      interimRef.current = heard.interim;
      setInterim(heard.interim);
    };
    rec.onerror = (event) => {
      if (event?.error === "not-allowed" || event?.error === "service-not-allowed") {
        wantRef.current = false;
        setMicError("Microphone access is blocked. Allow the microphone for this site (the lock icon next to the address), then tap again, or switch to Write.");
      } else if (event?.error === "audio-capture") {
        wantRef.current = false;
        setMicError("No microphone found. Plug one in, or switch to Write.");
      }
    };
    rec.onend = () => {
      if (recRef.current !== rec) return;
      commitBrowser();
      const now = Date.now();
      restartsRef.current = [...restartsRef.current.filter((at) => now - at < 10_000), now];
      // Desktop browsers end a session after a pause: start a fresh one quietly. Android does not restart (it beeps).
      if (wantRef.current && !android && restartsRef.current.length < 6) {
        window.setTimeout(() => {
          if (wantRef.current && recRef.current === rec) {
            try {
              startSessionRef.current();
              return;
            } catch {
              // fall through
            }
          }
        }, 150);
        return;
      }
      stopBrowser();
      if (android && textRef.current) flash("Paused. Tap to speak to keep going.");
    };
    recRef.current = rec;
    rec.start();
  }, [commitBrowser, flash, language, putText, stopBrowser]);

  useEffect(() => {
    startSessionRef.current = startSession;
  }, [startSession]);

  const startBrowser = useCallback(() => {
    wantRef.current = true;
    restartsRef.current = [];
    try {
      startSession();
      listenStartRef.current = Date.now();
      setListening(true);
    } catch {
      wantRef.current = false;
      setMicError("Speech-to-text could not start. Tap to try again, or switch to Write.");
    }
  }, [startSession]);

  // ---------- Shared controls ----------
  const stopListening = useCallback(() => {
    if (recorderRef.current) void stopCloud();
    else stopBrowser();
  }, [stopBrowser, stopCloud]);

  const startListening = useCallback(() => {
    setError(null);
    setMicError(null);
    if (!engine) {
      setSupported(false);
      return;
    }
    if (listenedMsRef.current / 1000 >= maxSeconds) {
      setError(`That's the ${maxLong} limit. Edit your words, then add them.`);
      return;
    }
    if (engine === "cloud") void startCloud();
    else startBrowser();
  }, [engine, maxLong, maxSeconds, startBrowser, startCloud]);

  useEffect(() => {
    if (!listening) return;
    const timer = window.setInterval(() => {
      const total = (listenedMsRef.current + (listenStartRef.current ? Date.now() - listenStartRef.current : 0)) / 1000;
      setSeconds(total);
      setLevel(levelRef.current);
      setQuiet(Boolean(recorderRef.current && !heardRef.current && listenStartRef.current && Date.now() - listenStartRef.current > 5000));
      if (total >= maxSeconds) stopListening();
    }, 100);
    return () => window.clearInterval(timer);
  }, [listening, maxSeconds, stopListening]);

  useEffect(
    () => () => {
      wantRef.current = false;
      void recorderRef.current?.stop();
      try {
        recRef.current?.abort?.();
      } catch {
        // ignore
      }
    },
    [],
  );

  // ---- The words box: type, paste or drop freely; the AI check decides what is used. ----
  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const now = Date.now();
    if (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete" || event.key === "Enter") {
      keysRef.current += 1;
      const gap = now - lastKeyRef.current;
      if (lastKeyRef.current && gap < 5000) typedMsRef.current += gap;
      lastKeyRef.current = now;
    }
  };
  const onChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    let next = event.target.value;
    if (next.length > maxChars) next = next.slice(0, maxChars);
    if (recRef.current) {
      // The person edited while the browser was still hearing: keep what they see as the new base,
      // and skip the words of this session that are already in it.
      baseRef.current = next;
      usedWordsRef.current += shownWordsRef.current;
      shownWordsRef.current = 0;
      interimRef.current = "";
      setInterim("");
    }
    textRef.current = next;
    setText(next);
  };

  const shown = text + (interim ? `${text && !/\s$/.test(text) ? " " : ""}${interim}` : "");
  const words = shown.trim() ? shown.trim().split(/\s+/).length : 0;
  const remaining = Math.max(0, maxSeconds - seconds);

  async function submit() {
    if (closed || busy) return;
    if (recorderRef.current) await stopCloud();
    else if (listening) stopListening();
    // Wait for the last clips to come back as words.
    for (let waited = 0; pendingRef.current > 0 && waited < 30_000; waited += 200) await new Promise((done) => setTimeout(done, 200));
    const finalText = (textRef.current || text).trim();
    if (finalText.length < 12) {
      setError("Add a few more words first.");
      return;
    }
    if (!name.trim()) {
      setError("Add the name you want printed in the book.");
      return;
    }
    if (!consent) {
      setError("Tick the box to say we can quote you.");
      return;
    }
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/books/${bookId}/voices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: finalText,
        mode,
        name,
        language,
        country: country || null,
        handle: handle.trim().replace(/^@/, ""),
        ageBand,
        region: region.trim(),
        consent,
        invite,
        metrics: {
          activeMs: listenedMsRef.current + typedMsRef.current,
          keys: keysRef.current,
          spoken: spokenRef.current,
        },
      }),
    }).catch(() => null);
    const data = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);
    if (!response || !response.ok) {
      setError(data.error ?? "Your words were not saved. Try again.");
      return;
    }
    router.push(`/b/${slug}/voice/thanks?id=${data.id}`);
    router.refresh();
  }

  if (paused) {
    return (
      <main className="page speak vf">
        <div className="narrow">
          <div className="done">
            <h1>Voices are paused right now</h1>
            <p className="lead">This book reached its AI usage limit. Voices open again when the creator raises it. Nothing stored is deleted.</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="page speak vf">
      <div className="narrow vf__wrap">
        <header className="vf__head">
          <span className="label red">Add your voice</span>
          <h1 className="vf__q">{question}</h1>
          <p className="vf__lead">Tell us a real moment, in your own words. Voices close {opens}.</p>
        </header>

        <section className="vf__card" aria-label="About you">
          <h2 className="vf__h">About you</h2>
          <div className="vf__grid">
            <label className="field">
              <span>Name in the book</span>
              <input id="name" className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Priya S." autoComplete="name" maxLength={40} />
            </label>
            <label className="field">
              <span>Country</span>
              <select
                id="country"
                className="input"
                value={country}
                onChange={(event) => {
                  setCountry(event.target.value);
                  setRegion("");
                  setRegionOther(false);
                }}
              >
                <option value="">Prefer not to say</option>
                {COUNTRIES.map((item) => (
                  <option key={item.code} value={item.code}>
                    {flagEmoji(item.code)} {item.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <details className="vf__more">
            <summary>More about you <em>optional</em></summary>
            <AboutFields
              nameLabel=""
              name={name}
              setName={setName}
              handle={handle}
              setHandle={setHandle}
              ageBand={ageBand}
              setAgeBand={setAgeBand}
              country={country}
              setCountry={setCountry}
              region={region}
              setRegion={setRegion}
              regionOther={regionOther}
              setRegionOther={setRegionOther}
              language={language}
              setLanguage={setLanguage}
              extrasOnly
            />
          </details>
          <label className="check vf__consent">
            <input data-testid="consent" type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            <span>I&apos;m 18+. Quote my words with my name. AI sorts them and never trains on them.</span>
          </label>
        </section>

        <section className="vf__card" aria-label="Your answer">
          <div className="vf__modes" role="tablist" aria-label="How do you want to answer?">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "write"}
              className={`vf__mode${mode === "write" ? " on" : ""}`}
              data-testid="mode-write"
              onClick={() => {
                if (listening) stopListening();
                setMode("write");
                setError(null);
              }}
            >
              <IconPen /> Write
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "speak"}
              className={`vf__mode vf__mode--speak${mode === "speak" ? " on" : ""}`}
              data-testid="mode-speak"
              onClick={() => {
                setMode("speak");
                setError(null);
              }}
            >
              <IconMicBig /> Speak
            </button>
          </div>

          <label className="vf__lang">
            <span>{mode === "speak" ? "I'll speak in" : "I'll write in"}</span>
            <select
              id="language"
              className="input"
              value={language}
              disabled={listening}
              onChange={(event) => setLanguage(event.target.value)}
            >
              {SPEAK_LANGUAGES.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          {supported === false && mode === "speak" ? (
            <p className="vf__warn" role="status" data-testid="speech-unsupported">
              Speech-to-text isn&apos;t available in this browser. Try Chrome, Edge or Safari, or tap Write and type your answer.
            </p>
          ) : mode === "speak" ? (
            (
              <div className={`vf__rec${listening ? " on" : ""}`} data-testid="speech-status" data-state={listening ? "recording" : pending > 0 ? "processing" : "idle"}>
                <button
                  type="button"
                  className="vf__recbtn"
                  data-testid={listening ? "stop-speaking" : "start-speaking"}
                  onClick={() => (listening ? stopListening() : startListening())}
                  disabled={starting}
                  aria-label={listening ? "Stop" : "Tap to speak"}
                >
                  {listening ? <IconStop /> : <IconMicBig />}
                </button>
                <b className="vf__reclabel">{listening ? "Stop" : starting ? "Starting…" : text ? "Tap to keep speaking" : "Tap to speak"}</b>
                {listening ? (
                  <div className="vf__recrow">
                    <span className="vf__clock">
                      <i className="vf__live" /> {clock(seconds)} <em>· {clock(remaining)} left</em>
                    </span>
                    {engine === "cloud" ? (
                      <span className="vf__level" data-testid="level" aria-hidden="true">
                        {[0.15, 0.3, 0.5, 0.7, 0.9].map((step, index) => (
                          <i key={index} className={Math.min(1, level * 9) >= step ? "on" : ""} />
                        ))}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <span className="vf__rechelp">Your words will appear here. We never keep your audio.</span>
                )}
                {listening && quiet ? (
                  <span className="vf__recwarn" role="status" data-testid="mic-quiet">
                    We can&apos;t hear anything yet. Check that your microphone is on and not muted.
                  </span>
                ) : null}
                {micError && !listening ? (
                  <div className="vf__recerr" role="alert" data-testid="mic-error">
                    <span>{micError}</span>
                    <button
                      type="button"
                      className="vf__recalt"
                      onClick={() => {
                        setMicError(null);
                        setMode("write");
                      }}
                    >
                      Use Write instead
                    </button>
                  </div>
                ) : null}
                {pending > 0 ? (
                  <span className="vf__proc" role="status" data-testid="speech-processing">
                    <i className="vf__spin" aria-hidden="true" /> Turning speech into words…
                  </span>
                ) : null}
              </div>
            )
          ) : (
            <p className="vf__hint">Type or paste your answer, in your own words. AI checks every voice before it goes in the book.</p>
          )}

          <div className="vf__box">
            <textarea
              className="vf__text"
              data-testid="words"
              aria-label="Your words"
              value={shown}
              placeholder={mode === "speak" ? (listening ? "Keep talking. Words appear after each pause." : "Your words will appear here. You can fix any word.") : "Start typing your answer…"}
              rows={7}
              spellCheck
              onChange={onChange}
              onKeyDown={onKeyDown}
            />
            <div className="vf__meta">
              <span>{words} {words === 1 ? "word" : "words"}</span>
              {note ? (
                <span className="vf__note" role="status" data-testid="paste-note">
                  {note}
                </span>
              ) : (
                <span>{shown.length > maxChars * 0.9 ? `${maxChars - shown.length} characters left` : "Edit freely"}</span>
              )}
            </div>
          </div>
        </section>

        {error ? (
          <p role="alert" className="vf__err" data-testid="voice-error">
            {error}
          </p>
        ) : null}
        <button
          className="btn btn--red btn--big btn--block vf__send"
          type="button"
          data-testid="send-words"
          onClick={() => void submit()}
          disabled={busy || closed || shown.trim().length < 12 || !consent || !name.trim()}
        >
          {busy ? "Adding your words…" : "Add my words"}
        </button>
        <div className="under">
          {leftToday} left today · your words stay sealed until the book is released
        </div>
      </div>
    </main>
  );
}

function AboutFields({
  nameLabel,
  name,
  setName,
  handle,
  setHandle,
  ageBand,
  setAgeBand,
  country,
  setCountry,
  region,
  setRegion,
  regionOther,
  setRegionOther,
  language,
  setLanguage,
  showLanguage,
  extrasOnly,
}: {
  nameLabel: string;
  name: string;
  setName: (value: string) => void;
  handle: string;
  setHandle: (value: string) => void;
  ageBand: string;
  setAgeBand: (value: string) => void;
  country: string;
  setCountry: (value: string) => void;
  region: string;
  setRegion: (value: string) => void;
  regionOther: boolean;
  setRegionOther: (value: boolean) => void;
  language: string;
  setLanguage: (value: string) => void;
  showLanguage?: boolean;
  extrasOnly?: boolean;
}) {
  const regions = regionsFor(country);
  const known = regions.includes(region);
  return (
    <>
      {extrasOnly ? null : (
        <label className="field">
          <span>{nameLabel}</span>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Priya S." autoComplete="name" maxLength={40} />
        </label>
      )}
      <label className="field">
        <span>X username</span>
        <div className="at">
          <input className="input" value={handle.replace(/^@/, "")} onChange={(event) => setHandle(event.target.value.replace(/^@/, ""))} placeholder="yourname" autoCapitalize="off" autoComplete="off" maxLength={15} />
        </div>
      </label>
      <div className="field">
        <span>Age</span>
        <div className="seg">
          {AGE_BANDS.map((band) => (
            <button key={band} type="button" className={ageBand === band ? "on" : ""} onClick={() => setAgeBand(band)}>
              {band}
            </button>
          ))}
        </div>
      </div>
      {extrasOnly ? null : (
        <label className="field">
          <span>Country</span>
          <select className="input" value={country} onChange={(event) => setCountry(event.target.value)}>
            {COUNTRIES.map((item) => (
              <option key={item.code} value={item.code}>
                {flagEmoji(item.code)} {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="field">
        <span>State / region</span>
        {regions.length ? (
          <select
            className="input"
            value={regionOther || (region && !known) ? "__other" : region}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "__other") {
                setRegionOther(true);
                setRegion("");
                return;
              }
              setRegionOther(false);
              setRegion(value);
            }}
          >
            <option value="" disabled>
              Choose…
            </option>
            {regions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
            <option value="__other">Other…</option>
          </select>
        ) : null}
        {!regions.length || regionOther || (region && !known) ? (
          <input className="input" value={regionOther || !known ? region : ""} onChange={(event) => setRegion(event.target.value)} placeholder="Your state or region" maxLength={40} style={regions.length ? { marginTop: 8 } : undefined} />
        ) : null}
      </div>
      {showLanguage ? (
        <label className="field">
          <span>Language</span>
          <select className="input" value={language} onChange={(event) => setLanguage(event.target.value)}>
            {LANGUAGES.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </>
  );
}
