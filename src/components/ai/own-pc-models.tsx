import { LOCAL_MODELS, downloadUrl, formatBytes } from "@/lib/ai/local-catalog";

/**
 * Shown where the server can't run local models (the hosted site). Honest: the model runs on the
 * creator's own PC, not here, so books on this site still need an API key.
 */
export function OwnPcModels({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`ownpc${compact ? " ownpc--compact" : ""}`}>
      <ul className="ownpc__list">
        {LOCAL_MODELS.map((model) => (
          <li key={model.id}>
            <span className="ownpc__name">
              <b>{model.name}</b>
              {model.tag ? <i className={model.recommended ? "new" : ""}>{model.tag}</i> : null}
            </span>
            <span className="ownpc__meta">
              {formatBytes(model.bytes)} · {model.ramGb} GB RAM
            </span>
            <a className="ownpc__dl" href={downloadUrl(model)} target="_blank" rel="noreferrer" download>
              Download
            </a>
          </li>
        ))}
      </ul>
      <ol className="ownpc__how">
        <li>
          Install{" "}
          <a href="https://ollama.com/download" target="_blank" rel="noreferrer">
            Ollama
          </a>{" "}
          or{" "}
          <a href="https://lmstudio.ai" target="_blank" rel="noreferrer">
            LM Studio
          </a>
          .
        </li>
        <li>
          Open the file, or run <code>ollama run llama3.2:3b</code>.
        </li>
        <li>It runs free on your PC. This hosted site can&apos;t reach your PC, so books here still use an API key.</li>
      </ol>
    </div>
  );
}
