"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { COUNTRIES, flagEmoji } from "@/lib/countries";
import { LANGUAGES } from "@/lib/languages";
import { SPEAK_LANGUAGES } from "@/lib/speak-languages";
import { AGE_BANDS, regionsFor } from "@/lib/regions";
import { answerLimits } from "@/lib/book/answer-limits";

/** Write only: type or paste an answer. No microphone, no audio. */
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
  const { maxChars, maxWords } = answerLimits(maxSeconds);
  const router = useRouter();
  const [language, setLanguage] = useState(defaultLanguage);
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

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  async function submit() {
    if (closed || busy) return;
    const finalText = text.trim();
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
        mode: "write",
        name,
        language,
        country: country || null,
        handle: handle.trim().replace(/^@/, ""),
        ageBand,
        region: region.trim(),
        consent,
        invite,
        metrics: { activeMs: startedAt ? Date.now() - startedAt : 0, keys, spoken: 0 },
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
          <div className="vf__answerhead">
            <h2 className="vf__h">Your answer</h2>
            <label className="vf__lang">
              <span>I&apos;ll write in</span>
              <select id="language" className="input" value={language} onChange={(event) => setLanguage(event.target.value)}>
                {SPEAK_LANGUAGES.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="vf__hint">In your own words, up to about {maxWords.toLocaleString("en-US")} words. Typing or pasting is fine. AI checks every voice before it goes in the book.</p>

          <div className="vf__box">
            <textarea
              className="vf__text"
              data-testid="words"
              aria-label="Your words"
              value={text}
              placeholder="Start typing your answer…"
              rows={8}
              spellCheck
              maxLength={maxChars}
              onKeyDown={() => {
                if (!startedAt) setStartedAt(Date.now());
                setKeys((count) => count + 1);
              }}
              onChange={(event) => {
                if (!startedAt) setStartedAt(Date.now());
                setText(event.target.value.slice(0, maxChars));
              }}
            />
            <div className="vf__meta">
              <span>
                {words} {words === 1 ? "word" : "words"}
              </span>
              <span>{text.length > maxChars * 0.9 ? `${maxChars - text.length} characters left` : "Edit freely"}</span>
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
          disabled={busy || closed || text.trim().length < 12 || !consent || !name.trim()}
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
