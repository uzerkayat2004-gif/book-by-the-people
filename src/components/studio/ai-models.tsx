"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PROVIDER_PRESETS, presetFor, type ProviderRole, type ProviderType, type ProviderView } from "@/lib/ai/provider-types";
import { formatBytes, type LocalStatus } from "@/lib/ai/local-catalog";

const ROLE_LABEL: Record<ProviderRole, string> = { writer: "Writer", transcription: "Transcription", both: "Writer + transcription" };

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

/** The creator's AI models, in the order they are tried. Keys stay on the server. */
export function AiModels({ initial, mockServer, onChange }: { initial: ProviderView[]; mockServer: boolean; onChange?: () => void }) {
  const [providers, setProviders] = useState(initial);
  const [editing, setEditing] = useState<ProviderView | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const data = await call<{ providers: ProviderView[] }>("/api/ai/providers", "GET");
    setProviders(data.providers);
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

  function move(index: number, by: -1 | 1) {
    const next = [...providers];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    setProviders(next);
    void act("order", async () => {
      const data = await call<{ providers: ProviderView[] }>("/api/ai/providers", "PUT", { ids: next.map((row) => row.id) });
      setProviders(data.providers);
    });
  }

  return (
    <div className="s2-models">
      {providers.length === 0 ? (
        <div className="s2-empty">
          <b>No models yet.</b>
          <span>{mockServer ? "Demo mode runs until you add one. " : "The server key is used until you add one. "}Download a local Meta model below, or add a key.</span>
        </div>
      ) : (
        <ol className="s2-plist">
          {providers.map((row, index) => (
            <li key={row.id} className={row.enabled ? "" : "off"}>
              <span className="s2-plist__n">{index + 1}</span>
              <div className="s2-plist__main">
                <b>{row.label}</b>
                <span className="s2-plist__meta">
                  {row.typeName} · <code>{row.model || "default model"}</code>
                  {row.hasKey ? <> · key ••••{row.keyLast4}</> : null}
                  {" · "}
                  {ROLE_LABEL[row.role as ProviderRole] ?? row.role}
                </span>
                {row.lastTestAt ? (
                  <span className={`s2-test ${row.lastTestOk ? "ok" : "bad"}`}>{row.lastTestOk ? "✓ " : "✕ "}{row.lastTestMsg}</span>
                ) : (
                  <span className="s2-test">Not tested yet</span>
                )}
              </div>
              <div className="s2-plist__act">
                <button className="s2-icon" type="button" aria-label="Move up" disabled={index === 0 || busy !== null} onClick={() => move(index, -1)}>
                  ↑
                </button>
                <button className="s2-icon" type="button" aria-label="Move down" disabled={index === providers.length - 1 || busy !== null} onClick={() => move(index, 1)}>
                  ↓
                </button>
                <button
                  className="s2-btn s2-btn--sm"
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    act(`test-${row.id}`, async () => {
                      const data = await call<{ provider: ProviderView | null }>(`/api/ai/providers/${row.id}/test`, "POST");
                      if (data.provider) setProviders((list) => list.map((item) => (item.id === row.id ? data.provider! : item)));
                    })
                  }
                >
                  {busy === `test-${row.id}` ? "Testing…" : "Test"}
                </button>
                <button className="s2-btn s2-btn--sm s2-btn--ghost" type="button" disabled={busy !== null} onClick={() => setEditing(row)}>
                  Edit
                </button>
                <button
                  className={`s2-switch${row.enabled ? " on" : ""}`}
                  type="button"
                  role="switch"
                  aria-checked={row.enabled}
                  aria-label={row.enabled ? "Turn off" : "Turn on"}
                  disabled={busy !== null}
                  onClick={() =>
                    act(`on-${row.id}`, async () => {
                      const data = await call<{ provider: ProviderView }>(`/api/ai/providers/${row.id}`, "PATCH", { enabled: !row.enabled });
                      setProviders((list) => list.map((item) => (item.id === row.id ? data.provider : item)));
                    })
                  }
                >
                  <i />
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {providers.length > 1 ? <p className="s2-fine">Tried top to bottom. If one fails, the next one takes over.</p> : null}
      {error ? <p className="s2-err">{error}</p> : null}
      {editing ? (
        <ProviderForm
          key={editing === "new" ? "new" : editing.id}
          row={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
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
          onSaved={async (saved, test) => {
            setEditing(null);
            await reload();
            if (test) {
              await act(`test-${saved.id}`, async () => {
                const data = await call<{ provider: ProviderView | null }>(`/api/ai/providers/${saved.id}/test`, "POST");
                if (data.provider) setProviders((list) => list.map((item) => (item.id === saved.id ? data.provider! : item)));
              });
            } else onChange?.();
          }}
        />
      ) : (
        <button className="s2-btn s2-btn--ghost" type="button" onClick={() => setEditing("new")}>
          + Add a model
        </button>
      )}
    </div>
  );
}

function ProviderForm({
  row,
  onCancel,
  onSaved,
  onDelete,
}: {
  row: ProviderView | null;
  onCancel: () => void;
  onSaved: (saved: ProviderView, test: boolean) => void | Promise<void>;
  onDelete?: () => void;
}) {
  const [type, setType] = useState<ProviderType>((row?.type as ProviderType) ?? "gemini");
  const preset = presetFor(type);
  const [label, setLabel] = useState(row?.label ?? preset.name);
  const [baseUrl, setBaseUrl] = useState(row?.baseUrl ?? preset.baseUrl);
  const [model, setModel] = useState(row?.model ?? preset.model);
  const [role, setRole] = useState<ProviderRole>((row?.role as ProviderRole) ?? "writer");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const local = type === "local";

  function pickType(next: ProviderType) {
    const was = presetFor(type);
    const now = presetFor(next);
    setType(next);
    if (!label || label === was.name) setLabel(now.name);
    if (!baseUrl || baseUrl === was.baseUrl) setBaseUrl(now.baseUrl);
    if (!model || model === was.model) setModel(now.model);
    if (role !== "writer" && !canTranscribe(next)) setRole("writer");
  }

  async function submit(test: boolean) {
    setBusy(true);
    setError(null);
    try {
      const body = { label, type, baseUrl, model, role, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) };
      const data = row
        ? await call<{ provider: ProviderView }>(`/api/ai/providers/${row.id}`, "PATCH", body)
        : await call<{ provider: ProviderView }>("/api/ai/providers", "POST", body);
      setApiKey("");
      await onSaved(data.provider, test);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Not saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="s2-pform"
      autoComplete="off"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(true);
      }}
    >
      <div className="s2-pform__grid">
        <label className="s2-field">
          <span>Type</span>
          <select className="s2-input" value={type} disabled={local} onChange={(event) => pickType(event.target.value as ProviderType)}>
            {PROVIDER_PRESETS.filter((item) => !item.internal || item.type === type).map((item) => (
              <option key={item.type} value={item.type}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="s2-field">
          <span>Label</span>
          <input className="s2-input" value={label} maxLength={60} onChange={(event) => setLabel(event.target.value)} />
        </label>
        {!local ? (
          <label className="s2-field s2-field--wide">
            <span>
              API key {preset.keyRequired ? "" : <em>optional</em>}
            </span>
            <input
              className="s2-input"
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              placeholder={row?.hasKey ? `Saved ••••${row.keyLast4} — paste a new key to replace it` : preset.keyRequired ? "Paste the key" : "Not needed"}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
        ) : null}
        <label className="s2-field">
          <span>Base URL</span>
          <input className="s2-input s2-mono" value={baseUrl} disabled={local} placeholder="https://…/v1" onChange={(event) => setBaseUrl(event.target.value)} />
        </label>
        <label className="s2-field">
          <span>Model</span>
          <input className="s2-input s2-mono" value={model} disabled={local} placeholder="model name" onChange={(event) => setModel(event.target.value)} />
        </label>
        <label className="s2-field">
          <span>Used for</span>
          <select className="s2-input" value={role} onChange={(event) => setRole(event.target.value as ProviderRole)}>
            <option value="writer">Writer (checks, translation, the book)</option>
            {canTranscribe(type) ? <option value="transcription">Transcription only</option> : null}
            {canTranscribe(type) ? <option value="both">Both</option> : null}
          </select>
        </label>
      </div>
      <p className="s2-fine">{preset.hint} Keys are encrypted on the server; only the last 4 characters are ever shown.</p>
      {error ? <p className="s2-err">{error}</p> : null}
      <div className="s2-row">
        <button className="s2-btn s2-btn--red" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save and test"}
        </button>
        <button className="s2-btn s2-btn--ghost" type="button" disabled={busy} onClick={() => void submit(false)}>
          Save
        </button>
        <button className="s2-btn s2-btn--ghost" type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        {onDelete ? (
          <button className="s2-link s2-link--danger" type="button" disabled={busy} onClick={onDelete}>
            Delete
          </button>
        ) : null}
      </div>
    </form>
  );
}

const PHASE: Record<string, string> = {
  runtime: "Getting the runtime",
  model: "Downloading",
  starting: "Starting",
  testing: "Testing",
  done: "Ready",
  error: "Stopped",
  cancelled: "Cancelled",
};

/** One-click Meta Llama models that run on this computer. */
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

  if (!status) return <div className="s2-local s2-local--loading">{error ?? "Checking this computer…"}</div>;
  const job = status.job;
  const share = job && job.total > 0 ? Math.min(1, job.received / job.total) : 0;
  return (
    <div className="s2-local">
      <div className="s2-local__where">
        <span>
          Saved to <code>{status.dir}</code>
        </span>
        <span>
          {status.freeBytes !== null ? `${formatBytes(status.freeBytes)} free` : "free space unknown"} · {status.ramGb} GB RAM
          {status.dirSource === "auto" ? " · picked the drive with the most space" : status.dirSource === "env" ? " · from LOCAL_MODELS_DIR" : ""}
        </span>
      </div>
      <ul className="s2-lm">
        {status.models.map((model) => {
          const mine = job?.modelId === model.id ? job : null;
          const tooBig = status.ramGb > 0 && model.ramGb > status.ramGb;
          const running = status.running?.modelId === model.id;
          return (
            <li key={model.id} className={model.recommended ? "rec" : ""}>
              <div className="s2-lm__name">
                <b>{model.name}</b>
                {model.recommended ? <span className="s2-chip">recommended</span> : null}
                {running ? <span className="s2-chip s2-chip--ok">running</span> : null}
                <span className="s2-lm__meta">
                  {formatBytes(model.bytes)} download · needs {model.ramGb} GB RAM · {model.note}
                </span>
              </div>
              <div className="s2-lm__act">
                {mine && !["done", "error", "cancelled"].includes(mine.phase) ? (
                  <button className="s2-btn s2-btn--sm s2-btn--ghost" type="button" disabled={busy} onClick={() => void act({ action: "cancel" })}>
                    Cancel
                  </button>
                ) : model.installed || model.providerId ? (
                  <>
                    <span className="s2-ok">✓ {model.providerId ? "In use" : "Downloaded"}</span>
                    {!model.providerId ? (
                      <button className="s2-btn s2-btn--sm" type="button" disabled={busy || Boolean(active)} onClick={() => void act({ action: "download", modelId: model.id, engine: "builtin" })}>
                        Use it
                      </button>
                    ) : null}
                    {model.installed ? (
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
                  </>
                ) : (
                  <>
                    <button
                      className="s2-btn s2-btn--sm s2-btn--red"
                      type="button"
                      disabled={busy || Boolean(active) || !status.runtime.supported}
                      title={tooBig ? "This computer may not have enough memory for this one." : undefined}
                      onClick={() => void act({ action: "download", modelId: model.id, engine: "builtin" })}
                    >
                      Download
                    </button>
                    {status.ollama.running ? (
                      <button className="s2-link" type="button" disabled={busy || Boolean(active)} onClick={() => void act({ action: "download", modelId: model.id, engine: "ollama" })}>
                        {model.inOllama ? "Use from Ollama" : "via Ollama"}
                      </button>
                    ) : null}
                  </>
                )}
              </div>
              {mine ? (
                <div className={`s2-prog s2-prog--${mine.phase}`}>
                  <div className="s2-prog__bar" aria-hidden>
                    <i style={{ width: `${mine.phase === "done" ? 100 : Math.round(share * 100)}%` }} />
                  </div>
                  <span>
                    {(mine.phase === "done" || mine.phase === "error") && mine.message
                      ? mine.message
                      : `${PHASE[mine.phase] ?? mine.phase}${
                          mine.phase === "model" && mine.total > 0
                            ? ` · ${formatBytes(mine.received)} of ${formatBytes(mine.total)} · ${Math.round(share * 100)}%`
                            : mine.message
                              ? ` · ${mine.message}`
                              : ""
                        }`}
                  </span>
                  {["done", "error", "cancelled"].includes(mine.phase) ? (
                    <button className="s2-link" type="button" onClick={() => void act({ action: "clear" })}>
                      Dismiss
                    </button>
                  ) : null}
                </div>
              ) : null}
              {tooBig && !model.installed ? <span className="s2-fine">More than this computer&apos;s memory.</span> : null}
            </li>
          );
        })}
      </ul>
      <p className="s2-fine">
        {status.runtime.supported
          ? `Runs with llama.cpp ${status.runtime.build}${status.runtime.installed ? " (installed)" : " (downloaded with the first model, about 25 MB)"}. Downloads resume if stopped.`
          : "This computer type is not supported by the built-in runtime."}{" "}
        {status.ollama.running ? (
          `Ollama ${status.ollama.version} found.`
        ) : (
          <>
            Prefer Ollama?{" "}
            <a className="s2-link" href="https://ollama.com/download" target="_blank" rel="noreferrer">
              Install it
            </a>{" "}
            and it shows up here.
          </>
        )}
      </p>
      {error ? <p className="s2-err">{error}</p> : null}
    </div>
  );
}
