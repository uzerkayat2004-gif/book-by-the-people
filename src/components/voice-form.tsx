"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { COUNTRIES, flagEmoji } from "@/lib/countries";
import { LANGUAGES } from "@/lib/languages";
import { SPEAK_LANGUAGES } from "@/lib/speak-languages";
import { AGE_BANDS, regionsFor } from "@/lib/regions";
import { answerLimits } from "@/lib/book/answer-limits";
import { EN, fill, type Ui } from "@/lib/i18n";
import { useSpeech } from "@/components/voice/use-speech";

const LANGUAGE_KEY = "bbtp:voice-language";

function mmss(seconds: number) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * Add your voice: About you first, then the answer. Speak (in-browser speech to text, nothing
 * uploaded but the words) or Write (type or paste). Only text goes to the server.
 */
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
  ui = EN,
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
  /** Page words in the book's main language. */
  ui?: Ui;
}) {
  const t = ui;
  const { maxChars, maxWords } = answerLimits(maxSeconds);
  const router = useRouter();
  const [language, setLanguageState] = useState(defaultLanguage);
  const [text, setText] = useState("");
  const [name, setName] = useState(presetName);
  const [handle, setHandle] = useState("");
  const [ageBand, setAgeBand] = useState("");
  const [country, setCountry] = useState("IN");
  const [region, setRegion] = useState("");
  const [regionOther, setRegionOther] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [keys, setKeys] = useState(0);
  const [tab, setTab] = useState<"speak" | "write">("speak");
  // Hidden diagnostics (tap the status, or ?debug=1) so a stuck start can be screenshotted.
  const [debug, setDebug] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("debug") !== "1") return;
    const id = setTimeout(() => setDebug(true), 0);
    return () => clearTimeout(id);
  }, []);
  const [caretAt, setCaretAt] = useState<number | null>(null);
  const area = useRef<HTMLTextAreaElement | null>(null);
  const ghost = useRef<HTMLDivElement | null>(null);
  const caret = useRef<number | null>(null);
  const [wave, setWave] = useState<number[]>(() => Array(28).fill(0));

  const insert = useCallback(
    (words: string) => {
      if (!startedAt) setStartedAt(Date.now());
      setText((previous) => {
        const at = Math.min(caret.current ?? previous.length, previous.length);
        const before = previous.slice(0, at);
        const after = previous.slice(at);
        const lead = before && !/\s$/.test(before) ? " " : "";
        const trail = after && !/^\s/.test(after) ? " " : "";
        const next = (before + lead + words + trail + after).slice(0, maxChars);
        caret.current = Math.min(next.length, (before + lead + words).length);
        setCaretAt(caret.current);
        requestAnimationFrame(() => {
          const element = area.current;
          if (!element) return;
          if (document.activeElement === element && caret.current != null) element.setSelectionRange(caret.current, caret.current);
          if (caret.current != null && caret.current >= next.length - 1) element.scrollTop = element.scrollHeight;
        });
        return next;
      });
    },
    [maxChars, startedAt],
  );
  const speech = useSpeech(insert);
  const { setLanguage: setSpeechLanguage } = speech;

  // Remember the language this person speaks or writes in.
  useEffect(() => {
    const id = setTimeout(() => {
      const saved = window.localStorage.getItem(LANGUAGE_KEY);
      if (saved && SPEAK_LANGUAGES.some((item) => item.code === saved)) setLanguageState(saved);
    }, 0);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    setSpeechLanguage(language);
  }, [language, setSpeechLanguage]);
  function setLanguage(code: string) {
    setLanguageState(code);
    try {
      window.localStorage.setItem(LANGUAGE_KEY, code);
    } catch {
      // private mode: just don't remember
    }
  }

  // A moving sound line while listening, so the person sees the mic hears them.
  const level = useRef(0);
  useEffect(() => {
    level.current = speech.level;
  }, [speech.level]);
  useEffect(() => {
    if (speech.phase !== "listening") return;
    const timer = setInterval(() => setWave((list) => [...list.slice(1), level.current]), 70);
    return () => clearInterval(timer);
  }, [speech.phase]);

  useEffect(() => {
    (window as unknown as { __voice?: unknown }).__voice = {
      phase: speech.phase,
      why: speech.why,
      stage: speech.stage,
      problem: speech.problem,
      note: speech.note,
      detail: speech.detail,
      info: speech.info,
      chunks: speech.chunks,
      pending: speech.pending,
      percent: speech.percent,
      tab,
    };
  }, [speech.phase, speech.why, speech.stage, speech.problem, speech.note, speech.detail, speech.info, speech.chunks, speech.pending, speech.percent, tab]);

  // Speak is always shown. If this browser truly can't run it, tapping the mic says so and offers Write.
  const shownTab = tab;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  // Get the voice model ready as soon as the Speak tab shows, so it is usually ready before the tap.
  // Already on this device: always. Not yet: on computers, and on phones unless data saving is on.
  const { preload } = speech;
  // May this device download the model on its own? Not on data saver or mobile data.
  // Automated test browsers only do it when asked (?preload=1), so tests stay quick.
  const [eager] = useState(() => {
    if (typeof navigator === "undefined") return true;
    const connection = (navigator as unknown as { connection?: { saveData?: boolean; type?: string } }).connection;
    const thrifty = Boolean(connection?.saveData) || connection?.type === "cellular";
    const robot = navigator.webdriver && new URLSearchParams(window.location.search).get("preload") !== "1";
    return !(thrifty || robot);
  });
  // The model is (about to be) getting ready on its own: keep the mic off and say "warming up" until it is.
  const autoLoading = tab === "speak" && speech.phase === "idle" && !speech.info && !speech.problem && (speech.cached === null || speech.cached || eager);
  useEffect(() => {
    if (tab !== "speak" || speech.phase !== "idle" || speech.info || speech.problem || speech.cached === null) return;
    if (!speech.cached && !eager) return;
    const id = setTimeout(() => void preload(), 0);
    return () => clearTimeout(id);
  }, [tab, speech.phase, speech.info, speech.problem, speech.cached, preload, eager]);

  const listening = speech.phase === "listening";
  const writing = speech.pending > 0 || speech.phase === "finishing";
  const loading = speech.phase === "downloading" || speech.phase === "preparing";
  // "typing…" at the cursor while someone talks and while their words are being written.
  const typingNow = writing || (listening && speech.speaking);

  async function submit() {
    if (closed || busy) return;
    if (listening) await speech.stop();
    const finalText = text.trim();
    if (finalText.length < 12) {
      setError(t.errShort);
      return;
    }
    if (!name.trim()) {
      setError(t.errName);
      return;
    }
    if (!consent) {
      setError(t.errConsent);
      return;
    }
    setBusy(true);
    setError(null);
    const spoken = Math.round(speech.spokenMs / 1000);
    const response = await fetch(`/api/books/${bookId}/voices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: finalText,
        mode: spoken > 0 ? "speak" : "write",
        name,
        language,
        country: country || null,
        handle: handle.trim().replace(/^@/, ""),
        ageBand,
        region: region.trim(),
        consent,
        invite,
        metrics: { activeMs: startedAt ? Date.now() - startedAt : 0, keys, spoken },
      }),
    }).catch(() => null);
    const data = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);
    if (!response || !response.ok) {
      setError(data.error ?? t.errSave);
      return;
    }
    router.push(`/b/${slug}/voice/thanks?id=${data.id}`);
    router.refresh();
  }

  function rememberCaret(element: HTMLTextAreaElement) {
    caret.current = element.selectionStart;
    setCaretAt(element.selectionStart);
  }

  if (paused) {
    return (
      <main className="page speak vf">
        <div className="narrow">
          <div className="done">
            <h1>{t.pausedNow}</h1>
            <p className="lead">This book reached its AI usage limit. Voices open again when the creator raises it. Nothing stored is deleted.</p>
          </div>
        </div>
      </main>
    );
  }

  const problemText =
    speech.problem === "mic"
      ? t.errMic
      : speech.problem === "nomic"
        ? t.errNoMic
        : speech.problem === "micother"
          ? t.errMicOther
          : speech.problem === "model"
            ? t.errModel
            : speech.problem === "slow"
              ? t.errSlow
              : speech.problem === "unsupported"
                ? t.errUnsupported
                : "";
  const noteText =
    speech.note === "ready"
      ? t.modelReady
      : speech.note === "done"
        ? t.done
        : speech.note === "nothing"
          ? t.heardNothing
          : speech.note === "nospeech"
            ? t.noSpeech
            : speech.note === "nowords"
              ? t.noWords
              : speech.note === "left"
                ? t.leftPage
                : "";
  const typingAt = Math.min(caretAt ?? text.length, text.length);

  return (
    <main className="page speak vf">
      <div className="narrow vf__wrap">
        <header className="vf__head">
          <span className="label red">{t.addYourVoice}</span>
          <h1 className="vf__q">{question}</h1>
          <p className="vf__lead">{fill(t.lead, { when: opens })}</p>
        </header>

        <section className="vf__card" aria-label={t.aboutYou}>
          <h2 className="vf__h">{t.aboutYou}</h2>
          <div className="vf__grid">
            <label className="field">
              <span>{t.nameInBook}</span>
              <input id="name" className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Priya S." autoComplete="name" maxLength={40} />
            </label>
            <label className="field">
              <span>{t.country}</span>
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
                <option value="">{t.preferNot}</option>
                {COUNTRIES.map((item) => (
                  <option key={item.code} value={item.code}>
                    {flagEmoji(item.code)} {item.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <details className="vf__more">
            <summary>
              {t.moreAboutYou} <em>{t.optional}</em>
            </summary>
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
            <span>{t.consent}</span>
          </label>
        </section>

        <section className="vf__card" aria-label={t.yourAnswer}>
          <div className="vf__answerhead">
            <h2 className="vf__h">{t.yourAnswer}</h2>
            {(
              <div className="vf__tabs" role="tablist" aria-label={t.yourAnswer}>
                <button
                  type="button"
                  role="tab"
                  data-testid="tab-speak"
                  aria-selected={shownTab === "speak"}
                  className={shownTab === "speak" ? "on" : ""}
                  onClick={() => setTab("speak")}
                >
                  <MicIcon size={15} /> {t.speak}
                </button>
                <button
                  type="button"
                  role="tab"
                  data-testid="tab-write"
                  aria-selected={shownTab === "write"}
                  className={shownTab === "write" ? "on" : ""}
                  onClick={() => {
                    if (listening) void speech.stop();
                    setTab("write");
                  }}
                >
                  <PenIcon /> {t.write}
                </button>
              </div>
            )}
          </div>
          <label className="vf__lang">
            <span>{shownTab === "speak" ? t.speakIn : t.writeIn}</span>
            <select id="language" className="input" data-testid="voice-language" value={language} disabled={listening || loading} onChange={(event) => setLanguage(event.target.value)}>
              {SPEAK_LANGUAGES.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <p className="vf__hint">{shownTab === "speak" ? t.speakHint : fill(t.writeHint, { n: maxWords.toLocaleString("en-US") })}</p>

          {shownTab === "speak" ? (
            <div className={`vs vs--${speech.phase}${writing ? " is-writing" : ""}`} data-testid="speak-panel" data-phase={speech.phase}>
              <button
                type="button"
                className={`vs__mic${listening ? " is-on" : ""}`}
                data-testid="mic"
                aria-label={listening ? t.stop : t.tapToSpeak}
                aria-pressed={listening}
                disabled={loading || autoLoading || speech.phase === "finishing" || speech.checking}
                onClick={() => {
                  const element = area.current;
                  caret.current = element && document.activeElement === element ? element.selectionStart : (caret.current ?? text.length);
                  setCaretAt(caret.current);
                  void speech.toggle();
                }}
              >
                {listening ? <span className="vs__stopsq" aria-hidden /> : <MicIcon size={26} />}
              </button>
              <div className="vs__side" role="status" aria-live="polite" onClick={() => setDebug((on) => !on)}>
                {speech.phase === "downloading" ? (
                  <>
                    <b className="vs__state">{t.downloading}</b>
                    <span className="vs__bar" data-testid="download-bar">
                      <i style={{ width: `${speech.percent}%` }} />
                    </span>
                    <span className="vs__sub">
                      {speech.loadedMb ? `${speech.percent}% · ${speech.loadedMb} / ${speech.totalMb} MB` : `~${speech.totalMb} MB`}
                      {speech.stage === "retrying" ? ` · ${t.retrying}` : ""}
                    </span>
                    <span className="vs__sub">{t.pleaseWait}</span>
                  </>
                ) : speech.phase === "preparing" ? (
                  <>
                    <b className="vs__state" data-testid="warming">
                      <span className="vs__spin" aria-hidden /> {t.warmingUp}
                    </b>
                    <span className="vs__sub" data-testid="prep-sub">
                      {speech.stage === "retrying"
                        ? t.retrying
                        : speech.prepSec >= 15
                          ? t.slowStart
                          : speech.stage === "warming"
                            ? t.almostReady
                            : t.openingModel}
                      {/* Time spent so far (counts up), never a promise of how long is left. */}
                      {speech.prepSec >= 3 ? ` · ${speech.prepSec} s` : ""}
                    </span>
                  </>
                ) : listening ? (
                  <>
                    <b className="vs__state">
                      <span className="vs__dot" aria-hidden /> <span data-testid="listen-label">{speech.fresh ? t.startSpeaking : t.listening}</span> <span className="vs__time">{mmss(speech.elapsed)}</span>
                    </b>
                    <span className="vs__wave" aria-hidden data-testid="wave">
                      {wave.map((value, index) => (
                        <i key={index} style={{ transform: `scaleY(${Math.max(0.08, Math.min(1, value * 1.4))})` }} />
                      ))}
                    </span>
                    {writing ? <span className="vs__sub vs__writing">{t.writingWords}…</span> : null}
                  </>
                ) : speech.phase === "finishing" ? (
                  <b className="vs__state vs__writing">
                    <span className="vs__spin" aria-hidden /> {t.writingWords}…
                  </b>
                ) : autoLoading ? (
                  <>
                    <b className="vs__state" data-testid="warming">
                      <span className="vs__spin" aria-hidden /> {t.warmingUp}
                    </b>
                    <span className="vs__sub">{t.pleaseWait}</span>
                  </>
                ) : (
                  <>
                    <b className="vs__state" data-testid="mic-state">{speech.info ? t.readyTap : t.tapToSpeak}</b>
                    {speech.cached === false ? <span className="vs__sub">{fill(t.firstTime, { mb: speech.totalMb })}</span> : null}
                  </>
                )}
              </div>
            </div>
          ) : null}
          {shownTab === "speak" && debug ? (
            <p className="vs__diag" data-testid="voice-diag">
              {(() => {
                const d = speech.diagnostics();
                const parts = [
                  `threads ${d?.threads ?? "?"}`,
                  `isolated ${d?.isolated ? "yes" : "no"}`,
                  `cores ${d?.cores ?? "?"}`,
                  `${d?.backend === "webgpu" ? "GPU" : "CPU (wasm)"}`,
                  `phase ${speech.phase}/${speech.stage}`,
                  d?.readyMs ? `ready in ${(d.readyMs / 1000).toFixed(1)} s` : "not ready yet",
                  d?.safe ? "one-thread mode" : "",
                  d?.lastError || speech.detail ? `last error: ${d?.lastError || speech.detail}` : "",
                ];
                return parts.filter(Boolean).join(" · ");
              })()}
            </p>
          ) : null}

          <div className="vf__box">
            <div className="vf__field">
              <div className="vf__ghost" ref={ghost} aria-hidden>
                {typingNow ? (
                  <>
                    <span className="vf__ghosttext">{text.slice(0, typingAt)}</span>
                    {text.slice(0, typingAt) && !/\s$/.test(text.slice(0, typingAt)) ? " " : ""}
                    <span className="vf__typing" data-testid="typing">
                      {t.typing}
                    </span>
                  </>
                ) : null}
              </div>
              <textarea
                ref={area}
                className="vf__text"
                data-testid="words"
                aria-label={t.yourWords}
                value={text}
                placeholder={typingNow ? "" : shownTab === "speak" ? t.wordsPlaceholderSpeak : t.wordsPlaceholderWrite}
                rows={8}
                spellCheck
                maxLength={maxChars}
                onScroll={(event) => {
                  if (ghost.current) ghost.current.scrollTop = event.currentTarget.scrollTop;
                }}
                onKeyDown={() => {
                  if (!startedAt) setStartedAt(Date.now());
                  setKeys((count) => count + 1);
                }}
                onSelect={(event) => rememberCaret(event.currentTarget)}
                onChange={(event) => {
                  if (!startedAt) setStartedAt(Date.now());
                  setText(event.target.value.slice(0, maxChars));
                  rememberCaret(event.target);
                }}
              />
            </div>
            <div className="vf__meta">
              <span>{words === 1 ? t.wordCountOne : fill(t.wordCount, { n: words })}</span>
              <span>{text.length > maxChars * 0.9 ? fill(t.charsLeft, { n: maxChars - text.length }) : t.editFreely}</span>
            </div>
          </div>

          {shownTab === "speak" && problemText ? (
            <div className="vs__problem" role="alert" data-testid="speak-error">
              <p>{problemText}</p>
              <span className="vs__actions">
                {speech.problem === "model" || speech.problem === "micother" ? (
                  <button type="button" className="btn btn--ghost btn--sm" data-testid="speak-retry" onClick={() => void speech.toggle()}>
                    {t.tryAgain}
                  </button>
                ) : null}
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setTab("write")}>
                  {t.writeInstead}
                </button>
              </span>
            </div>
          ) : shownTab === "speak" && noteText ? (
            <p className="vs__note" role="status" data-testid="speak-note">
              {noteText}
            </p>
          ) : null}
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
          disabled={busy || closed || text.trim().length < 12 || !consent || !name.trim() || writing}
        >
          {busy ? t.adding : t.addMyWords}
        </button>
        <div className="under">{fill(t.leftToday, { n: leftToday })}</div>
      </div>
    </main>
  );
}

function MicIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function PenIcon() {
  return (
    <svg viewBox="0 0 24 24" width={15} height={15} aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h4L19 9l-4-4L4 16v4z" />
    </svg>
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
