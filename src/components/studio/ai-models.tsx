"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PROVIDER_PRESETS, presetFor, roleIncludes, type ProviderRole, type ProviderType, type ProviderView } from "@/lib/ai/provider-types";
import { formatBytes, SERVER_MODELS, type LocalStatus } from "@/lib/ai/local-catalog";

async function call<T>(url: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "That did not work.");
  return data;
}

function canTranscribe(type: string) {
  return type === "custom" || presetFor(type).transcribeModel !== "";
}

function statusOf(row: ProviderView): { tone: "ok" | "bad" | "idle"; text: string } {
  if (!row.enabled) return { tone: "idle", text: "Off" };
  if (row.lastTestAt === null) return { tone: "idle", text: "Not tested" };
  return row.lastTestOk ? { tone: "ok", text: "Works" } : { tone: "bad", text: "Failed" };
}

/**
 * One model picker. The picked model runs every AI step for all books.
 * Keys stay on the server; the browser only ever sees the last 4 characters.
 */
export function AiModels({
  initial,
  initialFallback = false,
  mockServer,
  onChange,
}: {
  initial: ProviderView[];
  initialFallback?: boolean;
  mockServer: boolean;
  onChange?: () => void;
}) {
  const [providers, setProviders] = useState(initial);
  const [fallback, setFallback] = useState(initialFallback);
  const [editing, setEditing] = useState<ProviderView | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const data = await call<{ providers: ProviderView[]; fallback: boolean }>("/api/ai/providers", "GET");
    setProviders(data.providers);
    setFallback(data.fallback);
  }, []);

  async function act(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await work();
      onChange?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  const writers = providers.filter((row) => roleIncludes(row.role, "writer"));
  const picked = writers.find((row) => row.enabled) ?? null;
  const hearer = providers.find((row) => row.enabled && roleIncludes(row.role, "transcription")) ?? null;
  const speechOnly = providers.filter((row) => row.role === "transcription");

  function pick(row: ProviderView) {
    if (picked?.id === row.id) return;
    const ids = [row.id, ...providers.filter((item) => item.id !== row.id).map((item) => item.id)];
    void act(`pick-${row.id}`, async () => {
      if (!row.enabled) await call(`/api/ai/providers/${row.id}`, "PATCH", { enabled: true });
      const data = await call<{ providers: ProviderView[] }>("/api/ai/providers", "PUT", { ids });
      setProviders(data.providers);
    });
  }

  async function test(id: string) {
    const data = await call<{ provider: ProviderView | null }>(`/api/ai/providers/${id}/test`, "POST");
    if (data.provider) setProviders((list) => list.map((item) => (item.id === id ? data.provider! : item)));
  }

  return (
    <div className="s3-models">
      <div className="s3-picker" role="radiogroup" aria-label="Model">
        {writers.length === 0 ? (
          <div className="s3-pick s3-pick--empty">
            <b>{mockServer ? "Demo mode" : "Server default"}</b>
            <span>Add a model or download one below.</span>
          </div>
        ) : (
          writers.map((row) => {
            const on = picked?.id === row.id;
            const status = statusOf(row);
            return (
              <div key={row.id} className={`s3-pick${on ? " on" : ""}${row.enabled ? "" : " off"}`}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className="s3-pick__main"
                  disabled={busy !== null}
                  onClick={() => pick(row)}
                >
                  <i className="s3-radio" aria-hidden />
                  <span className="s3-pick__text">
                    <b>{row.label}</b>
                    <span>
                      {row.type === "local" || row.type === "ollama" ? "On this computer" : row.typeName}
                      {row.hasKey ? ` · ••••${row.keyLast4}` : ""}
                    </span>
                  </span>
                  <span className={`s3-dot s3-dot--${status.tone}`}>{busy === `test-${row.id}` ? "Testing…" : status.text}</span>
                </button>
                <button className="s3-more" type="button" aria-label={`Edit ${row.label}`} disabled={busy !== null} onClick={() => setEditing(row)}>
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                    <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
                    <circle cx="8" cy="8" r="1.3" fill="currentColor" />
                    <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
                  </svg>
                </button>
              </div>
            );
          })
        )}
      </div>

      <div className="s3-models__foot">
        <button className="s2-btn s2-btn--sm" type="button" disabled={busy !== null} onClick={() => setEditing("new")}>
          + Add model
        </button>
        {picked ? (
          <button className="s2-btn s2-btn--sm s2-btn--ghost" type="button" disabled={busy !== null} onClick={() => void act(`test-${picked.id}`, () => test(picked.id))}>
            {busy === `test-${picked.id}` ? "Testing…" : "Test"}
          </button>
        ) : null}
        <span className="s3-speech">
          Speech: <b>{hearer ? hearer.label : "Browser"}</b>
          {speechOnly.map((row) => (
            <button key={row.id} className="s2-link" type="button" onClick={() => setEditing(row)}>
              Edit
            </button>
          ))}
        </span>
      </div>
      {picked?.lastTestOk === false ? <p className="s2-err">{picked.lastTestMsg}</p> : null}
      {error ? <p className="s2-err">{error}</p> : null}

      {writers.length > 1 ? (
        <label className="s3-quiet">
          <input
            type="checkbox"
            checked={fallback}
            disabled={busy !== null}
            onChange={(event) => {
              const next = event.target.checked;
              setFallback(next);
              void act("fallback", async () => {
                const data = await call<{ fallback: boolean }>("/api/ai/providers", "PUT", { fallback: next });
                setFallback(data.fallback);
              });
            }}
          />
          If it fails, try the next one
        </label>
      ) : null}

      {editing ? (
        <ProviderSheet
          key={editing === "new" ? "new" : editing.id}
          row={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onDelete={
            editing === "new"
              ? undefined
              : () =>
                  act("delete", async () => {
                    if (!window.confirm(`Delete ${editing.label}? Its key is removed too.`)) return;
                    await call(`/api/ai/providers/${editing.id}`, "DELETE");
                    setEditing(null);
                    await reload();
                  })
          }
          onToggle={
            editing === "new"
              ? undefined
              : () =>
                  act(`on-${editing.id}`, async () => {
                    await call(`/api/ai/providers/${editing.id}`, "PATCH", { enabled: !editing.enabled });
                    setEditing(null);
                    await reload();
                  })
          }
          onSaved={async (saved, isNew) => {
            setEditing(null);
            await reload();
            await act(`test-${saved.id}`, async () => {
              // A new model becomes the picked one: whatever you add is what runs.
              if (isNew && roleIncludes(saved.role, "writer")) {
                const data = await call<{ providers: ProviderView[] }>("/api/ai/providers", "GET");
                const ids = [saved.id, ...data.providers.filter((item) => item.id !== saved.id).map((item) => item.id)];
                await call("/api/ai/providers", "PUT", { ids });
                await reload();
              }
              await test(saved.id);
            });
          }}
        />
      ) : null}
    </div>
  );
}

const TYPE_ORDER: ProviderType[] = ["meta", "openrouter", "together", "fireworks", "groq", "openai", "gemini", "anthropic", "ollama", "custom"];

/** Add or edit a model: type → key → model. Everything else is under Advanced. */
function ProviderSheet({
  row,
  onClose,
  onSaved,
  onDelete,
  onToggle,
}: {
  row: ProviderView | null;
  onClose: () => void;
  onSaved: (saved: ProviderView, isNew: boolean) => void | Promise<void>;
  onDelete?: () => void;
  onToggle?: () => void;
}) {
  const [type, setType] = useState<ProviderType>((row?.type as ProviderType) ?? "meta");
  const preset = presetFor(type);
  const [label, setLabel] = useState(row?.label ?? preset.name);
  const [baseUrl, setBaseUrl] = useState(row?.baseUrl ?? preset.baseUrl);
  const [model, setModel] = useState(row?.model ?? preset.model);
  const [role, setRole] = useState<ProviderRole>((row?.role as ProviderRole) ?? (canTranscribe(type) && type === "meta" ? "both" : "writer"));
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const local = type === "local";
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    dialog.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function pickType(next: ProviderType) {
    const was = presetFor(type);
    const now = presetFor(next);
    setType(next);
    if (!label || label === was.name) setLabel(now.name);
    if (!baseUrl || baseUrl === was.baseUrl) setBaseUrl(now.baseUrl);
    if (!model || model === was.model || was.models.includes(model)) setModel(now.model);
    if (!canTranscribe(next)) setRole("writer");
    else if (next === "meta" && !row) setRole("both");
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const body = { label, type, baseUrl, model, role, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) };
      const data = row
        ? await call<{ provider: ProviderView }>(`/api/ai/providers/${row.id}`, "PATCH", body)
        : await call<{ provider: ProviderView }>("/api/ai/providers", "POST", body);
      setApiKey("");
      await onSaved(data.provider, !row);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Not saved.");
    } finally {
      setBusy(false);
    }
  }

  const types = TYPE_ORDER.map((item) => presetFor(item)).filter((item) => !item.internal);
  return (
    <div className="s3-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="s3-sheet" role="dialog" aria-modal="true" aria-labelledby="s3-sheet-title" ref={dialog}>
        <div className="s3-sheet__head">
          <h3 id="s3-sheet-title">{row ? row.label : "Add model"}</h3>
          <button className="s3-x" type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <form
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {!local ? (
            <fieldset className="s3-step">
              <legend>
                <i>1</i> Provider
              </legend>
              <div className="s3-types">
                {types.map((item) => (
                  <button
                    key={item.type}
                    type="button"
                    className={type === item.type ? "on" : ""}
                    aria-pressed={type === item.type}
                    onClick={() => pickType(item.type)}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}
          {!local ? (
            <label className="s3-step">
              <span className="s3-legend">
                <i>2</i> API key {preset.keyRequired ? null : <em>optional</em>}
              </span>
              <input
                data-autofocus
                className="s2-input"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                placeholder={row?.hasKey ? `Saved ••••${row.keyLast4}` : preset.keyRequired ? "Paste key" : "Not needed"}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>
          ) : null}
          <label className="s3-step">
            <span className="s3-legend">
              <i>{local ? 1 : 3}</i> Model
            </span>
            <input className="s2-input s2-mono" list={`s3-models-${type}`} value={model} disabled={local} placeholder="model id" onChange={(event) => setModel(event.target.value)} />
            <datalist id={`s3-models-${type}`}>
              {preset.models.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
            {preset.models.length > 1 && !local ? (
              <span className="s3-sugg">
                {preset.models.slice(0, 4).map((item) => (
                  <button key={item} type="button" className={item === model ? "on" : ""} onClick={() => setModel(item)}>
                    {item.split("/").pop()}
                  </button>
                ))}
              </span>
            ) : null}
          </label>
          <details className="s3-adv">
            <summary>Advanced</summary>
            <label className="s2-field">
              <span>Name</span>
              <input className="s2-input" value={label} maxLength={60} onChange={(event) => setLabel(event.target.value)} />
            </label>
            <label className="s2-field">
              <span>Base URL</span>
              <input className="s2-input s2-mono" value={baseUrl} disabled={local} placeholder="https://…/v1" onChange={(event) => setBaseUrl(event.target.value)} />
            </label>
            <label className="s2-field">
              <span>Used for</span>
              <select className="s2-input" value={role} onChange={(event) => setRole(event.target.value as ProviderRole)}>
                <option value="writer">Everything except speech</option>
                {canTranscribe(type) ? <option value="both">Everything, including speech</option> : null}
                {canTranscribe(type) ? <option value="transcription">Speech only</option> : null}
              </select>
            </label>
          </details>
          {error ? <p className="s2-err">{error}</p> : null}
          <div className="s3-sheet__act">
            <button className="s2-btn s2-btn--red" type="submit" disabled={busy || (!row && preset.keyRequired && !apiKey.trim()) || !model.trim()}>
              {busy ? "Saving…" : row ? "Save and test" : "Add and test"}
            </button>
            <button className="s2-btn s2-btn--ghost" type="button" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <span className="s3-grow" />
            {onToggle && row ? (
              <button className="s2-link" type="button" disabled={busy} onClick={onToggle}>
                {row.enabled ? "Turn off" : "Turn on"}
              </button>
            ) : null}
            {onDelete ? (
              <button className="s2-link s2-link--danger" type="button" disabled={busy} onClick={onDelete}>
                Delete
              </button>
            ) : null}
          </div>
          <p className="s3-lock">Key stays encrypted on the server.</p>
        </form>
      </div>
    </div>
  );
}

const PHASE: Record<string, string> = {
  runtime: "Getting runtime",
  model: "Downloading",
  starting: "Starting",
  testing: "Testing",
  done: "Ready",
  error: "Stopped",
  cancelled: "Cancelled",
};

/** Meta open-weight models that run on this computer, plus the ones that need a server. */
export function LocalModels({ onChange }: { onChange?: () => void }) {
  const [status, setStatus] = useState<LocalStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lastPhase = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await call<LocalStatus>("/api/ai/local", "GET");
      setStatus(next);
      const phase = next.job?.phase ?? null;
      if (phase !== lastPhase.current && (phase === "done" || phase === "error")) onChange?.();
      lastPhase.current = phase;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read local models.");
    }
  }, [onChange]);

  const active = status?.job && !["done", "error", "cancelled"].includes(status.job.phase);
  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), active ? 700 : 8000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [load, active]);

  async function act(body: Record<string, string>) {
    setBusy(true);
    setError(null);
    try {
      setStatus(await call<LocalStatus>("/api/ai/local", "POST", body));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  if (!status) return <div className="s3-local s3-local--loading">{error ?? "Checking this computer…"}</div>;
  const job = status.job;
  const share = job && job.total > 0 ? Math.min(1, job.received / job.total) : 0;
  return (
    <div className="s3-local">
      <ul className="s3-lm">
        {status.models.map((model) => {
          const mine = job?.modelId === model.id ? job : null;
          const moving = mine && !["done", "error", "cancelled"].includes(mine.phase);
          const tooBig = status.ramGb > 0 && model.ramGb > status.ramGb;
          return (
            <li key={model.id} className={`${model.recommended ? "rec" : ""}${tooBig ? " big" : ""}`}>
              <div className="s3-lm__top">
                <b>{model.name}</b>
                {model.tag ? <span className={`s3-tag${model.recommended ? " s3-tag--new" : ""}`}>{model.tag}</span> : null}
              </div>
              <span className="s3-lm__meta">
                {formatBytes(model.bytes)} · {model.ramGb} GB RAM{model.note ? ` · ${model.note}` : ""}
              </span>
              <div className="s3-lm__act">
                {moving ? (
                  <button className="s2-btn s2-btn--sm s2-btn--ghost" type="button" disabled={busy} onClick={() => void act({ action: "cancel" })}>
                    Cancel
                  </button>
                ) : model.providerId ? (
                  <span className="s2-ok">✓ Ready</span>
                ) : model.installed ? (
                  <button className="s2-btn s2-btn--sm" type="button" disabled={busy || Boolean(active)} onClick={() => void act({ action: "download", modelId: model.id, engine: "builtin" })}>
                    Use
                  </button>
                ) : (
                  <button
                    className="s2-btn s2-btn--sm s2-btn--red"
                    type="button"
                    disabled={busy || Boolean(active) || !status.runtime.supported}
                    onClick={() => void act({ action: "download", modelId: model.id, engine: status.ollama.running && model.inOllama ? "ollama" : "builtin" })}
                  >
                    {status.ollama.running && model.inOllama ? "Use from Ollama" : "Download"}
                  </button>
                )}
                {model.installed && !moving ? (
                  <button
                    className="s2-link s2-link--danger"
                    type="button"
                    disabled={busy || Boolean(active)}
                    onClick={() => {
                      if (window.confirm(`Delete ${model.name} from this computer?`)) void act({ action: "remove", modelId: model.id });
                    }}
                  >
                    Delete
                  </button>
                ) : null}
              </div>
              {mine ? (
                <div className={`s2-prog s2-prog--${mine.phase}`}>
                  <div className="s2-prog__bar" aria-hidden>
                    <i style={{ width: `${mine.phase === "done" ? 100 : Math.round(share * 100)}%` }} />
                  </div>
                  <span>
                    {(mine.phase === "done" || mine.phase === "error") && mine.message
                      ? mine.message
                      : `${PHASE[mine.phase] ?? mine.phase}${mine.phase === "model" && mine.total > 0 ? ` · ${Math.round(share * 100)}%` : ""}`}
                  </span>
                  {["done", "error", "cancelled"].includes(mine.phase) ? (
                    <button className="s2-link" type="button" onClick={() => void act({ action: "clear" })}>
                      OK
                    </button>
                  ) : null}
                </div>
              ) : tooBig && !model.installed ? (
                <span className="s3-lm__warn">More than this computer&apos;s {status.ramGb} GB</span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="s3-server">
        <b>Needs a server</b>
        <ul>
          {SERVER_MODELS.map((model) => (
            <li key={model.name}>
              <span>{model.name}</span>
              <span className="s3-lm__meta">
                {model.size} · {model.needs}
              </span>
              <span className="s3-lm__meta">Add via {model.hosts}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="s3-where">
        <code>{status.dir}</code> · {status.freeBytes !== null ? `${formatBytes(status.freeBytes)} free` : "free space unknown"} · {status.ramGb} GB RAM
        {status.ollama.running ? ` · Ollama ${status.ollama.version}` : ""}
      </p>
      {!status.runtime.supported ? <p className="s2-err">This computer type is not supported by the built-in runtime.</p> : null}
      {error ? <p className="s2-err">{error}</p> : null}
    </div>
  );
}
