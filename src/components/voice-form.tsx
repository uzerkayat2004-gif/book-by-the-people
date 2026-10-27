"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconGoogle, IconLock } from "@/components/icons";
import { COUNTRIES, flagEmoji } from "@/lib/countries";
import { LANGUAGES } from "@/lib/languages";
import { SPEAK_LANGUAGES } from "@/lib/speak-languages";
import { AGE_BANDS, regionsFor } from "@/lib/regions";



const SPEECH_LANG: Record<string, string> = {
  en: "en-US",
  hinglish: "en-IN",
  hi: "hi-IN",
  es: "es-MX",
  fr: "fr-FR",
  de: "de-DE",
  pt: "pt-BR",
  ar: "ar-SA",
  ja: "ja-JP",
  zh: "zh-CN",
  ko: "ko-KR",
};

type SpeechResultEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

type SpeechRec = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function Dots({ on }: { on: number }) {
  return (
    <div className="stepdots">
      {[0, 1, 2, 3].map((step) => (
        <i key={step} className={step <= on ? "on" : ""} />
      ))}
    </div>
  );
}

export function VoiceForm({
  bookId,
  slug,
  question,
  invite,
  paused,
  demo,
  preview,
  opens,
  closed,
  surface = "full",
  presetName = "",
  presetWord = null,
  leftToday = 3,
  defaultLanguage = "en",
  maxSeconds = 600,
}: {
  bookId: string;
  slug: string;
  question: string;
  invite: string | null;
  paused: boolean;
  demo: boolean;
  preview: string | null;
  opens: string;
  closed?: boolean;
  surface?: "full" | "live";
  presetName?: string;
  presetWord?: string | null;
  leftToday?: number;
  defaultLanguage?: string;
  maxSeconds?: number;
}) {
  const maxShort = maxSeconds % 60 === 0 ? `${maxSeconds / 60} min` : `${maxSeconds} sec`;
  const maxLong = maxSeconds % 60 === 0 ? `${maxSeconds / 60} ${maxSeconds === 60 ? "minute" : "minutes"}` : `${maxSeconds} seconds`;
  const router = useRouter();
  const [language, setLanguage] = useState(defaultLanguage);
  const [startWord, setStartWord] = useState("");
  const [englishGloss, setEnglishGloss] = useState("");
  const [languageName, setLanguageName] = useState("English");
  const [challengeId, setChallengeId] = useState("");
  const [wordNonce, setWordNonce] = useState(0);
  const [name, setName] = useState(presetName);
  const [handle, setHandle] = useState("");
  const [ageBand, setAgeBand] = useState("");
  const [country, setCountry] = useState("IN");
  const [region, setRegion] = useState("");
  const [regionOther, setRegionOther] = useState(false);
  const [consent, setConsent] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [heard, setHeard] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const speechRef = useRef<SpeechRec | null>(null);
  const startedRef = useRef(0);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/books/${bookId}/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language, preferred: presetWord ?? undefined }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        setStartWord(data.startWord ?? "");
        setEnglishGloss(data.english ?? "");
        setLanguageName(data.languageName ?? "your language");
        setChallengeId(data.challengeId ?? "");
      })
      .catch(() => {
        if (!cancelled) setError("Could not load a start word.");
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, language, wordNonce, presetWord]);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedRef.current) / 1000);
      setSeconds(elapsed);
      if (elapsed >= maxSeconds) {
        speechRef.current?.stop();
        speechRef.current = null;
        recorderRef.current?.stop();
        recorderRef.current = null;
        setRecording(false);
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [recording, maxSeconds]);

  async function startRecording() {
    setError(null);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    const recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported(mime) ? { mimeType: mime } : undefined);
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      setFile(new File([blob], "voice.webm", { type: blob.type }));
      setPreviewUrl(URL.createObjectURL(blob));
      stream.getTracks().forEach((track) => track.stop());
    };
    const Speech = (window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec }).webkitSpeechRecognition;
    if (Speech) {
      const recognition = new Speech();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = SPEECH_LANG[language] ?? "en-US";
      recognition.onresult = (event) => {
        let text = "";
        for (let index = 0; index < event.results.length; index += 1) text += event.results[index][0].transcript;
        setHeard(text.trim());
      };
      recognition.onerror = () => undefined;
      recognition.onend = () => undefined;
      try {
        recognition.start();
        speechRef.current = recognition;
      } catch {
        speechRef.current = null;
      }
    }
    recorderRef.current = recorder;
    startedRef.current = Date.now();
    setSeconds(0);
    setRecording(true);
    recorder.start();
  }

  function stopRecording() {
    speechRef.current?.stop();
    speechRef.current = null;
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  async function submit() {
    if (closed || !file || !challengeId || busy) return;
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.set("audio", file);
    body.set("challengeId", challengeId);
    body.set("name", name);
    body.set("language", language);
    if (country) body.set("country", country);
    if (handle.trim()) body.set("handle", handle.trim().replace(/^@/, ""));
    if (ageBand) body.set("ageBand", ageBand);
    if (region.trim()) body.set("region", region.trim());
    body.set("consent", consent ? "true" : "false");
    body.set("durationMs", String(Math.max(seconds, 1) * 1000));
    if (invite) body.set("invite", invite);
    if (heard) body.set("clientTranscript", heard);
    const response = await fetch(`/api/books/${bookId}/voices`, { method: "POST", body });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(data.error ?? "The voice was not saved.");
      if (data.code === "start-word") {
        setFile(null);
        setPreviewUrl(null);
        setHeard("");
        setChallengeId("");
        setWordNonce((value) => value + 1);
      }
      return;
    }
    router.push(`/b/${slug}/voice/thanks?id=${data.id}`);
    router.refresh();
  }

  if (preview === "signin") {
    return (
      <main className="page speak">
        <div className="narrow">
          <Dots on={0} />
          <h1>Add your voice</h1>
          <p className="lead">Sign in with Google to add your voice. Only your name and country are shown.</p>
          <div className="grow" />
          <button className="gbtn" type="button">
            <IconGoogle /> Continue with Google
          </button>
          <div className="under">18+ · we never post for you</div>
        </div>
      </main>
    );
  }

  if (preview === "about") {
    return (
      <main className="page speak">
        <div className="narrow">
          <Dots on={1} />
          <h1>About you</h1>
          <AboutFields
            nameLabel="Your name"
            name={name}
            setName={setName}
            handle={handle}
            setHandle={setHandle}
            ageBand={ageBand}
            setAgeBand={setAgeBand}
            country={country}
            setCountry={(value) => {
              setCountry(value);
              setRegion("");
              setRegionOther(false);
            }}
            region={region}
            setRegion={setRegion}
            regionOther={regionOther}
            setRegionOther={setRegionOther}
            language={language}
            setLanguage={setLanguage}
            showLanguage
          />
          <div className="grow" />
          <button className="btn btn--red btn--big btn--block" type="button" onClick={() => router.push(`/b/${slug}/voice?step=ready`)}>
            Continue
          </button>
        </div>
      </main>
    );
  }

  if (preview === "ready") {
    return (
      <main className="page speak">
        <div className="narrow">
          <Dots on={2} />
          <p className="question">{question}</p>
          <p className="lead" style={{ marginTop: -6 }}>
            Tell us a real moment.
          </p>
          <div className="word">
            <span className="soft">Say this word first</span>
            <b data-testid="start-word">{startWord || "…"}</b>
          </div>
          <div className="grow" />
          <button className="btn btn--red btn--big btn--block" type="button" onClick={() => router.push(`/b/${slug}/voice?step=talk`)}>
            <span className="rec" />
            Start talking
          </button>
          <div className="under">Up to {maxShort}</div>
        </div>
      </main>
    );
  }

  if (preview === "talk") {
    const shown = 23;
    const ring = 565.5 * (1 - shown / 60);
    return (
      <main className="page speak">
        <div className="narrow">
          <Dots on={2} />
          <div className="label red">● Listening</div>
          <div className="ringwrap">
            <div className="ring">
              <svg viewBox="0 0 200 200">
                <circle className="trk" cx="100" cy="100" r="90" />
                <circle className="val" cx="100" cy="100" r="90" strokeDasharray="565.5" strokeDashoffset={ring} />
              </svg>
              <div className="t">
                <div>
                  <b>{shown}</b>
                  <small>OF 60 SEC</small>
                </div>
              </div>
            </div>
          </div>
          <div className="bars">
            {Array.from({ length: 14 }, (_, index) => (
              <i key={index} />
            ))}
          </div>
          <div className="transcript">The draft makes me smarter when I check the answer and lazier when I skip the draft.</div>
          <div className="grow" style={{ minHeight: 18 }} />
          <button className="btn btn--red btn--big btn--block" type="button" onClick={() => router.push(`/b/${slug}/voice?step=check`)}>
            Stop
          </button>
        </div>
      </main>
    );
  }

  if (preview === "check") {
    return (
      <main className="page speak">
        <div className="narrow">
          <Dots on={3} />
          <h1>Sounds right?</h1>
          <div className="transcript">The draft makes me smarter when I check the answer and lazier when I skip the draft.</div>
          <label className="check">
            <input data-testid="consent" type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            <span>I&apos;m 18+. Quote my words with my name. (AI sorts them; never trains on them.)</span>
          </label>
          <div className="grow" />
          <button className="btn btn--red btn--big btn--block" type="button" disabled={!consent} onClick={() => router.push(`/b/${slug}/voice?guest=1`)}>
            Send
          </button>
          <div className="under">
            <button className="link" type="button" onClick={() => router.push(`/b/${slug}/voice?step=ready`)}>
              Try again
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (preview === "done") {
    return (
      <main className="page speak">
        <div className="narrow">
          <div className="done">
            <div className="sealbig">
              <IconLock />
            </div>
            <h1>Sealed.</h1>
            <p className="lead">Opens {opens}.</p>
          </div>
          <div className="grow" />
          <Link className="btn btn--red btn--big btn--block" href={`/b/${slug}`}>
            Done
          </Link>
        </div>
      </main>
    );
  }

  if (paused) {
    return (
      <main className="page speak">
        <div className="narrow">
          <div className="done">
            <h1>Voices are paused right now</h1>
            <p className="lead">New recordings wait until the spend cap is raised. Nothing already stored is deleted.</p>
          </div>
        </div>
      </main>
    );
  }

  const ring = 565.5 * (1 - Math.min(60, seconds) / 60);
  return (
    <main className="page speak">
      <div className="narrow">
        <Dots on={recording ? 2 : file ? 3 : 2} />
        <p className="question">{question}</p>
        <p className="lead">Tell us a real moment.</p>
        <div className="word liveword">
          <span className="label">Start with this word</span>
          <b data-testid="start-word">{startWord || "…"}</b>
          {englishGloss && language !== "en" ? <span className="muted">({englishGloss})</span> : <span className="muted">({startWord || "…"})</span>}
          <p className="hint" data-testid="start-word-help">
            Say it first, then share your thoughts. It shows you&apos;re a real person speaking right now.
            {demo && surface !== "live" ? " If the start word isn’t first, the take is thrown away." : ""}
          </p>
          <p className="hint" style={{ fontFamily: "var(--serif)", fontStyle: "italic" }}>
            {startWord || "…"}… I think AI is making me…
          </p>
        </div>
        <label className="field">
          <span>I&apos;ll speak in</span>
          <select id="language" className="input" value={language} onChange={(event) => setLanguage(event.target.value)}>
            {SPEAK_LANGUAGES.slice(0, 2).map((item) => (
              <option key={item.code} value={item.code}>
                {item.label}
              </option>
            ))}
            <option disabled value="sep">
              ──────
            </option>
            {SPEAK_LANGUAGES.slice(2).map((item) => (
              <option key={item.code} value={item.code}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">Any language. We translate it to English.</p>
        <p className="sr">{languageName}</p>
        {surface === "live" && !file ? null : (
          <>
        <label className="field">
          <span>Name in the book</span>
          <input id="name" className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Priya S." autoComplete="name" maxLength={40} />
        </label>
        <label className="field">
          <span>Country</span>
          <select id="country" className="input" value={country} onChange={(event) => { setCountry(event.target.value); setRegion(""); setRegionOther(false); }}>
            <option value="">Prefer not to say</option>
            {COUNTRIES.map((item) => (
              <option key={item.code} value={item.code}>
                {flagEmoji(item.code)} {item.name}
              </option>
            ))}
          </select>
        </label>
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
          </>
        )}
        {recording ? (
          <>
            <div className="label red">● Listening</div>
            <div className="ringwrap">
              <div className="ring">
                <svg viewBox="0 0 200 200">
                  <circle className="trk" cx="100" cy="100" r="90" />
                  <circle className="val" cx="100" cy="100" r="90" strokeDasharray="565.5" strokeDashoffset={ring} />
                </svg>
                <div className="t">
                  <div>
                    <b>{seconds}</b>
                    <small>SEC</small>
                  </div>
                </div>
              </div>
            </div>
            <div className="bars">
              {Array.from({ length: 14 }, (_, index) => (
                <i key={index} />
              ))}
            </div>
            <div className="transcript">{heard}</div>
          </>
        ) : null}
        {surface === "live" && !file ? null : (
          <label className="check">
            <input data-testid="consent" type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            <span>I&apos;m 18+. Quote my words with my name. (AI sorts them; never trains on them.)</span>
          </label>
        )}
        <div className="grow" />
        {!recording ? (
          <button className="btn btn--red btn--big btn--block" type="button" onClick={() => void startRecording()}>
            <span className="rec" />
            Start talking
          </button>
        ) : (
          <button className="btn btn--red btn--big btn--block" type="button" onClick={stopRecording}>
            Stop
          </button>
        )}
        {surface === "live" && !file ? (
          <div className="under">Up to {maxShort} · {leftToday} left today</div>
        ) : (
          <>
            <div className="under">
              <label>
                or upload a recording
                <input
                  data-testid="audio-file"
                  type="file"
                  accept="audio/*"
                  onChange={(event) => {
                    const next = event.target.files?.[0] ?? null;
                    setFile(next);
                    setPreviewUrl(next ? URL.createObjectURL(next) : null);
                    setHeard("");
                    setSeconds(4);
                  }}
                />
              </label>
            </div>
            {previewUrl ? <audio controls src={previewUrl} className="w-full" style={{ marginTop: 12, width: "100%" }} /> : null}
            {error ? (
              <p data-testid="start-word-error" role="alert" className="err">
                {error} Record again.
              </p>
            ) : null}
            <button className="btn btn--red btn--big btn--block" type="button" onClick={() => void submit()} disabled={busy || !file || !consent} style={{ marginTop: 12 }}>
              {busy ? "Saving the voice…" : "Add this voice"}
            </button>
            <div className="under">Up to {maxLong} · say the word, then answer</div>
          </>
        )}
        {surface === "live" && !file && error ? (
          <p data-testid="start-word-error" role="alert" className="err">
            {error} Record again.
          </p>
        ) : null}
        <p className="sr">
          <IconLock size={1} />
        </p>
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
