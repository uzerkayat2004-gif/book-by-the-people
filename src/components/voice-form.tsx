"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { COUNTRIES, flagEmoji } from "@/lib/countries";
import { LANGUAGES } from "@/lib/languages";
import { SPEAK_LANGUAGES } from "@/lib/speak-languages";
import { AGE_BANDS, regionsFor } from "@/lib/regions";

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

/** Joins a new phrase onto the text with one space and a capital at sentence starts. */
function joinPhrase(text: string, phrase: string) {
  const clean = phrase.replace(/\s+/g, " ").trim();
  if (!clean) return text;
  const base = text.replace(/\s+$/, "");
  if (!base) return clean.charAt(0).toUpperCase() + clean.slice(1);
  const capital = /[.!?]$/.test(base) ? clean.charAt(0).toUpperCase() + clean.slice(1) : clean;
  return `${base} ${capital}`;
}

const BLOCKED_INPUT = new Set(["insertFromPaste", "insertFromPasteAsQuotation", "insertFromDrop", "insertFromYank", "insertLink"]);
const PASTE_NOTE = "Pasting is off. Please type in your own words.";

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
}) {
  const maxLong = maxSeconds % 60 === 0 ? `${maxSeconds / 60} min` : `${maxSeconds} sec`;
  // About 150 spoken words a minute, ~6 characters each, so the text limit matches the time limit.
  const maxChars = Math.min(9000, Math.max(600, Math.round((maxSeconds / 60) * 150 * 6)));
  const router = useRouter();
  const [mode, setMode] = useState<"speak" | "write">("speak");
  const [supported, setSupported] = useState<boolean | null>(null);
  const [language, setLanguage] = useState(defaultLanguage);
  const [text, setText] = useState("");
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
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

  const recRef = useRef<SpeechRec | null>(null);
  const wantRef = useRef(false);
  const textRef = useRef("");
  const absorbedRef = useRef(new Set<number>());
  const pendingIdxRef = useRef<number[]>([]);
  const interimRef = useRef("");
  const listenStartRef = useRef(0);
  const listenedMsRef = useRef(0);
  const typedMsRef = useRef(0);
  const lastKeyRef = useRef(0);
  const keysRef = useRef(0);
  const spokenRef = useRef(0);
  const composingRef = useRef(false);
  const noteTimer = useRef<number | null>(null);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  useEffect(() => {
    // Feature detection has to wait for the browser; this runs once after hydration.
    const ok = Boolean(speechCtor());
    queueMicrotask(() => {
      setSupported(ok);
      if (!ok) setMode("write");
    });
  }, []);

  const flash = useCallback((message: string) => {
    setNote(message);
    if (noteTimer.current) window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote(null), 4000);
  }, []);

  const stopListening = useCallback(() => {
    wantRef.current = false;
    const rec = recRef.current;
    recRef.current = null;
    if (listenStartRef.current) {
      listenedMsRef.current += Date.now() - listenStartRef.current;
      listenStartRef.current = 0;
    }
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
    const pending = interimRef.current;
    if (pending) {
      const next = joinPhrase(textRef.current, pending);
      spokenRef.current += pending.length;
      textRef.current = next;
      setText(next);
    }
    interimRef.current = "";
    setInterim("");
    setListening(false);
  }, []);

  const restartRef = useRef<() => void>(() => {});
  const startSession = useCallback(() => {
    const Ctor = speechCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = SPEECH_LANG[language] ?? language;
    absorbedRef.current = new Set();
    rec.onresult = (event) => {
      let pending = "";
      const pendingIdx: number[] = [];
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const phrase = result[0]?.transcript ?? "";
        if (result.isFinal) {
          if (absorbedRef.current.has(index)) continue;
          absorbedRef.current.add(index);
          const next = joinPhrase(textRef.current, phrase);
          spokenRef.current += phrase.trim().length;
          textRef.current = next;
          setText(next);
        } else if (!absorbedRef.current.has(index)) {
          pending += phrase;
          pendingIdx.push(index);
        }
      }
      pendingIdxRef.current = pendingIdx;
      interimRef.current = pending.trim();
      setInterim(pending.trim());
    };
    rec.onerror = (event) => {
      if (event?.error === "not-allowed" || event?.error === "service-not-allowed") {
        wantRef.current = false;
        setError("The microphone is blocked. Allow it in your browser, or switch to Write.");
      } else if (event?.error === "audio-capture") {
        wantRef.current = false;
        setError("No microphone found. Plug one in, or switch to Write.");
      }
    };
    rec.onend = () => {
      // Browsers end a session after a pause. Keep listening until the person taps Stop.
      if (wantRef.current && recRef.current === rec) {
        try {
          restartRef.current();
          return;
        } catch {
          // fall through and stop
        }
      }
      if (recRef.current === rec) stopListening();
    };
    recRef.current = rec;
    rec.start();
  }, [language, stopListening]);

  useEffect(() => {
    restartRef.current = startSession;
  }, [startSession]);

  const startListening = useCallback(() => {
    setError(null);
    if (!speechCtor()) {
      setSupported(false);
      setMode("write");
      return;
    }
    if (listenedMsRef.current / 1000 >= maxSeconds) {
      setError(`That's the ${maxLong} limit. Edit your words, then add them.`);
      return;
    }
    wantRef.current = true;
    try {
      startSession();
      listenStartRef.current = Date.now();
      setListening(true);
    } catch {
      wantRef.current = false;
      setError("Speech-to-text could not start. Try again, or switch to Write.");
    }
  }, [maxLong, maxSeconds, startSession]);

  useEffect(() => {
    if (!listening) return;
    const timer = window.setInterval(() => {
      const total = (listenedMsRef.current + (listenStartRef.current ? Date.now() - listenStartRef.current : 0)) / 1000;
      setSeconds(total);
      if (total >= maxSeconds) stopListening();
    }, 250);
    return () => window.clearInterval(timer);
  }, [listening, maxSeconds, stopListening]);

  useEffect(() => () => {
    wantRef.current = false;
    try {
      recRef.current?.abort?.();
    } catch {
      // ignore
    }
  }, []);

  // ---- The words box: typing is fine, pasting and dropping are not. ----
  const blockPaste = (event: React.SyntheticEvent) => {
    event.preventDefault();
    flash(PASTE_NOTE);
  };
  const onBeforeInput = (event: React.FormEvent<HTMLTextAreaElement>) => {
    const native = event.nativeEvent as InputEvent;
    const kind = native.inputType ?? "";
    const data = native.data ?? "";
    if (BLOCKED_INPUT.has(kind) || (kind === "insertReplacementText" && data.length > 40)) {
      event.preventDefault();
      flash(PASTE_NOTE);
    }
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const now = Date.now();
    if ((event.ctrlKey || event.metaKey) && (event.key === "v" || event.key === "V")) {
      event.preventDefault();
      flash(PASTE_NOTE);
      return;
    }
    if (event.shiftKey && event.key === "Insert") {
      event.preventDefault();
      flash(PASTE_NOTE);
      return;
    }
    if (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete" || event.key === "Enter") {
      keysRef.current += 1;
      const gap = now - lastKeyRef.current;
      if (lastKeyRef.current && gap < 5000) typedMsRef.current += gap;
      lastKeyRef.current = now;
    }
  };
  const onChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    let next = event.target.value;
    const before = text + (interim ? ` ${interim}` : "");
    // Anything big that arrives without keys (autofill, a paste that slipped through) is refused.
    if (!composingRef.current && next.length - before.length > 40 && Date.now() - lastKeyRef.current > 400) {
      flash(PASTE_NOTE);
      return;
    }
    if (next.length > maxChars) next = next.slice(0, maxChars);
    if (interim) {
      // The person edited while a phrase was still being heard: keep what they see, drop the duplicate final.
      for (const index of pendingIdxRef.current) absorbedRef.current.add(index);
      pendingIdxRef.current = [];
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
    if (listening) stopListening();
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

        <section className="vf__card" aria-label="Your answer">
          <div className="vf__modes" role="tablist" aria-label="How do you want to answer?">
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

          {supported === false ? (
            <p className="vf__warn" role="status" data-testid="speech-unsupported">
              Speech-to-text isn&apos;t available in this browser. Try Chrome, Edge or Safari, or write your answer below.
            </p>
          ) : mode === "speak" ? (
            (
              <div className={`vf__mic${listening ? " on" : ""}`}>
                <button
                  type="button"
                  className="vf__micbtn"
                  data-testid={listening ? "stop-speaking" : "start-speaking"}
                  onClick={() => (listening ? stopListening() : startListening())}
                  aria-label={listening ? "Stop" : "Start speaking"}
                >
                  {listening ? <IconStop /> : <IconMicBig />}
                </button>
                <div className="vf__micinfo">
                  <b>{listening ? "Listening… your words appear below" : text ? "Tap to keep talking" : "Tap and start talking"}</b>
                  <span>
                    {listening ? (
                      <>
                        <i className="vf__live" /> {clock(seconds)} · {clock(remaining)} left
                      </>
                    ) : (
                      `No keyword needed. Up to ${maxLong}. Only the words are kept, never your audio.`
                    )}
                  </span>
                </div>
              </div>
            )
          ) : (
            <p className="vf__hint">Type your answer. Pasting is turned off so every answer is written here, by a person.</p>
          )}

          <div className="vf__box">
            <textarea
              className="vf__text"
              data-testid="words"
              aria-label="Your words"
              value={shown}
              placeholder={mode === "speak" ? "Your words will appear here as you speak. You can fix any word." : "Start typing your answer…"}
              rows={7}
              spellCheck
              onChange={onChange}
              onKeyDown={onKeyDown}
              onBeforeInput={onBeforeInput}
              onPaste={blockPaste}
              onDrop={blockPaste}
              onDragOver={(event) => event.preventDefault()}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={() => {
                composingRef.current = false;
              }}
            />
            <div className="vf__meta">
              <span>{words} {words === 1 ? "word" : "words"}</span>
              {note ? (
                <span className="vf__note" role="status" data-testid="paste-note">
                  {note}
                </span>
              ) : (
                <span>{shown.length > maxChars * 0.9 ? `${maxChars - shown.length} characters left` : mode === "speak" ? "Edit freely" : "No pasting"}</span>
              )}
            </div>
          </div>
        </section>

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
