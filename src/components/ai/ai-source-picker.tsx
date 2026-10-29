"use client";

import { useEffect, useMemo, useState } from "react";
import type { AiChoice, AiOptions } from "@/lib/ai/book-source";
import { NEW_KEY_TYPES, modelChoices, modelLabel, presetFor, type ProviderType } from "@/lib/ai/provider-types";
import { OwnPcModels } from "./own-pc-models";

const SHORT: Record<string, string> = {
  meta: "Meta",
  openrouter: "OpenRouter",
  together: "Together",
  fireworks: "Fireworks",
  groq: "Groq",
  openai: "OpenAI",
  gemini: "Gemini",
  anthropic: "Anthropic",
  custom: "Custom",
};

const OTHER = "__other__";

export type AiPick = { choice: AiChoice | null; problem: string | null };

/**
 * The create form's AI step. Saved models first (pick one and its model); otherwise paste a key,
 * pick the provider and model, and test it. Local models are listed only where they can run.
 */
export function AiSourcePicker({
  options,
  onChange,
  alert = null,
}: {
  options: AiOptions;
  onChange: (pick: AiPick) => void;
  /** Shown inside the card when the form was sent without an AI. */
  alert?: string | null;
}) {
  const hasSaved = options.saved.length > 0 || options.serverKey;
  const [mode, setMode] = useState<"saved" | "new">(hasSaved ? "saved" : "new");
  const first = options.saved[0];
  const [picked, setPicked] = useState<string>(first ? `${first.kind}:${first.id}` : options.serverKey ? "server" : "");
  const [models, setModels] = useState<Record<string, string>>({});

  const [type, setType] = useState<ProviderType>("meta");
  const preset = presetFor(type);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(preset.model);
  const [otherModel, setOtherModel] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [test, setTest] = useState<{ state: "idle" | "busy" | "ok" | "bad"; text: string }>({ state: "idle", text: "" });

  const pick: AiPick = useMemo(() => {
    if (mode === "saved") {
      if (picked === "server") return { choice: { source: "server" }, problem: null };
      if (picked === "demo") return { choice: { source: "demo" }, problem: null };
      const hit = options.saved.find((item) => `${item.kind}:${item.id}` === picked);
      if (!hit) return { choice: null, problem: "Pick a saved model, or use a new key." };
      if (hit.kind === "book") return { choice: { source: "book", bookId: hit.id }, problem: null };
      return { choice: { source: "provider", providerId: hit.id, model: models[picked] ?? hit.model }, problem: null };
    }
    const key = apiKey.trim();
    if (type !== "custom" && !key) return { choice: null, problem: "Paste your AI key, or pick a saved one." };
    if (type === "custom" && !baseUrl.trim()) return { choice: null, problem: "Add the base URL." };
    if (!model.trim()) return { choice: null, problem: "Add a model name." };
    return {
      choice: { source: "new", type, apiKey: key || undefined, model: model.trim(), baseUrl: baseUrl.trim() || undefined },
      problem: null,
    };
  }, [mode, picked, models, options.saved, apiKey, type, baseUrl, model]);

  useEffect(() => onChange(pick), [pick, onChange]);

  function pickType(next: ProviderType) {
    setType(next);
    setModel(presetFor(next).model);
    setOtherModel(next === "custom");
    setBaseUrl("");
    setTest({ state: "idle", text: "" });
  }

  async function runTest() {
    setTest({ state: "busy", text: "Testing…" });
    const response = await fetch("/api/ai/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, apiKey: apiKey.trim() || undefined, model: model.trim(), baseUrl: baseUrl.trim() || undefined }),
    }).catch(() => null);
    const data = (await response?.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
    if (response?.ok && data.ok) setTest({ state: "ok", text: data.message ?? "Key works." });
    else setTest({ state: "bad", text: data.error ?? data.message ?? "The test did not finish." });
  }

  const choices = modelChoices(type);
  return (
    <section className="setcard aisrc" aria-labelledby="aisrc-title">
      <div className="setcard__head">
        <h2 id="aisrc-title">
          <span className="nb">4</span> Your AI
        </h2>
        <span className="aisrc__lock" aria-hidden>
          Encrypted · never shown again
        </span>
      </div>
      {alert ? (
        <p className="err aisrc__err" role="alert">
          {alert}
        </p>
      ) : null}

      {mode === "saved" ? (
        <>
          <div className="aisrc__list" role="radiogroup" aria-label="Saved AI">
            {options.saved.map((item) => {
              const id = `${item.kind}:${item.id}`;
              const on = picked === id;
              const list = item.kind === "provider" && !item.local ? modelChoices(item.type, item.model) : [];
              const value = models[id] ?? item.model;
              return (
                <div key={id} className={`aisrc__row${on ? " on" : ""}`}>
                  <button type="button" role="radio" aria-checked={on} className="aisrc__main" onClick={() => setPicked(id)}>
                    <i className="aisrc__radio" aria-hidden />
                    <span className="aisrc__text">
                      <b>{item.label}</b>
                      <span>{item.detail}</span>
                    </span>
                    {item.local ? <em className="aisrc__tag">Local</em> : null}
                  </button>
                  {on && list.length > 0 ? (
                    <select
                      className="input aisrc__model"
                      aria-label="Model"
                      value={list.includes(value) ? value : list[0]}
                      onChange={(event) => setModels((all) => ({ ...all, [id]: event.target.value }))}
                    >
                      {list.map((name) => (
                        <option key={name} value={name}>
                          {modelLabel(name)}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
              );
            })}
            {options.serverKey ? (
              <div className={`aisrc__row${picked === "server" ? " on" : ""}`}>
                <button type="button" role="radio" aria-checked={picked === "server"} className="aisrc__main" onClick={() => setPicked("server")}>
                  <i className="aisrc__radio" aria-hidden />
                  <span className="aisrc__text">
                    <b>This server&apos;s key</b>
                    <span>Set by the site owner</span>
                  </span>
                </button>
              </div>
            ) : null}
            {options.demo ? (
              <div className={`aisrc__row${picked === "demo" ? " on" : ""}`}>
                <button type="button" role="radio" aria-checked={picked === "demo"} className="aisrc__main" onClick={() => setPicked("demo")}>
                  <i className="aisrc__radio" aria-hidden />
                  <span className="aisrc__text">
                    <b>Demo mode</b>
                    <span>Development only · no real AI</span>
                  </span>
                </button>
              </div>
            ) : null}
          </div>
          <button type="button" className="aisrc__link" onClick={() => setMode("new")}>
            + Use a new key
          </button>
        </>
      ) : (
        <>
          <div className="aisrc__types" role="radiogroup" aria-label="Provider">
            {NEW_KEY_TYPES.map((item) => (
              <button key={item} type="button" role="radio" aria-checked={type === item} className={type === item ? "on" : ""} onClick={() => pickType(item)}>
                {SHORT[item] ?? presetFor(item).name}
              </button>
            ))}
          </div>
          <label className="field" htmlFor="aiKey">
            <span>
              {SHORT[type]} key {type === "custom" ? <em>— if it needs one</em> : null}
            </span>
            <input
              id="aiKey"
              className={`input${alert && !apiKey.trim() ? " bad" : ""}`}
              aria-invalid={Boolean(alert && !apiKey.trim())}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste your key"
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                setTest({ state: "idle", text: "" });
              }}
            />
          </label>
          <div className="newbook__row">
            <label className="field" htmlFor="aiModel">
              <span>Model</span>
              {otherModel || choices.length === 0 ? (
                <input id="aiModel" className="input" spellCheck={false} placeholder="model id" value={model} onChange={(event) => setModel(event.target.value)} />
              ) : (
                <select
                  id="aiModel"
                  className="input"
                  value={model}
                  onChange={(event) => {
                    if (event.target.value === OTHER) {
                      setOtherModel(true);
                      setModel("");
                    } else setModel(event.target.value);
                  }}
                >
                  {choices.map((name) => (
                    <option key={name} value={name}>
                      {modelLabel(name)}
                    </option>
                  ))}
                  <option value={OTHER}>Other model…</option>
                </select>
              )}
            </label>
            <label className="field" htmlFor="aiBase">
              <span>Base URL</span>
              <input
                id="aiBase"
                className="input"
                spellCheck={false}
                placeholder={preset.baseUrl || "https://…/v1"}
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </label>
          </div>
          <div className="aisrc__foot">
            <button type="button" className="aisrc__test" disabled={test.state === "busy" || Boolean(pick.problem)} onClick={() => void runTest()}>
              {test.state === "busy" ? "Testing…" : "Test key"}
            </button>
            {test.text && test.state !== "busy" ? (
              <span className={`aisrc__result ${test.state}`} role="status">
                {test.text}
              </span>
            ) : null}
            <span className="aisrc__grow" />
            {hasSaved || options.demo ? (
              <button
                type="button"
                className="aisrc__link"
                onClick={() => {
                  setMode("saved");
                  if (!picked && options.demo) setPicked("demo");
                }}
              >
                {hasSaved ? "Use a saved model" : "Demo mode (dev)"}
              </button>
            ) : null}
          </div>
        </>
      )}

      <p className="hint">The app is free. You pay your AI provider only for what your books use.</p>
      {!options.localOn ? (
        <details className="aisrc__pc">
          <summary>Run a free Meta model on your own PC</summary>
          <OwnPcModels compact />
        </details>
      ) : !options.saved.some((item) => item.local) ? (
        <p className="hint">Free local models: download one in Book settings → AI model.</p>
      ) : null}
    </section>
  );
}
