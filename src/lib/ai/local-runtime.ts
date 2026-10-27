import "server-only";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, chmodSync, openSync, readSync, closeSync } from "node:fs";
import { statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { LOCAL_MODELS, localModelById, type LocalJob, type LocalModel } from "./local-catalog";

/**
 * Runs Meta's open Llama models on this computer.
 *
 * Built-in route (default): downloads a pinned llama.cpp release (llama-server)
 * and a GGUF file from Hugging Face (no token needed) into LOCAL_MODELS_DIR,
 * then starts llama-server on 127.0.0.1:LOCAL_MODEL_PORT. It speaks the
 * OpenAI chat-completions API, so the writer treats it like any other provider.
 *
 * Ollama route: when Ollama is running, the same model can be pulled through
 * Ollama's /api/pull instead (Ollama keeps its own model folder).
 */

export const LLAMA_CPP_BUILD = process.env.LLAMA_CPP_BUILD || "b11927";
export const LOCAL_PORT = Number(process.env.LOCAL_MODEL_PORT || 43180);
export const OLLAMA_URL = (process.env.OLLAMA_HOST ? (process.env.OLLAMA_HOST.startsWith("http") ? process.env.OLLAMA_HOST : `http://${process.env.OLLAMA_HOST}`) : "http://127.0.0.1:11434").replace(/\/$/, "");

type State = {
  job: (LocalJob & { abort?: AbortController }) | null;
  server: { child: ChildProcess; modelId: string; port: number; ready: Promise<void> } | null;
  dir: { path: string; source: "env" | "auto" | "default" } | null;
};

const globalState = globalThis as unknown as { __bbtpLocal?: State };
const state: State = (globalState.__bbtpLocal ??= { job: null, server: null, dir: null });

function assetName(build = LLAMA_CPP_BUILD): string | null {
  if (process.env.LLAMA_CPP_ASSET) return process.env.LLAMA_CPP_ASSET;
  const arch = process.arch;
  if (process.platform === "win32") return arch === "arm64" ? `llama-${build}-bin-win-cpu-arm64.zip` : `llama-${build}-bin-win-cpu-x64.zip`;
  if (process.platform === "darwin") return arch === "arm64" ? `llama-${build}-bin-macos-arm64.tar.gz` : `llama-${build}-bin-macos-x64.tar.gz`;
  if (process.platform === "linux") return arch === "arm64" ? `llama-${build}-bin-ubuntu-arm64.tar.gz` : arch === "x64" ? `llama-${build}-bin-ubuntu-x64.tar.gz` : null;
  return null;
}

/**
 * Where models go. LOCAL_MODELS_DIR wins. On Windows without it, the app
 * picks the fixed drive with the most free space when the project's drive is
 * nearly full (many laptops have a small C:).
 */
export async function modelsDir(): Promise<{ path: string; source: "env" | "auto" | "default" }> {
  if (process.env.LOCAL_MODELS_DIR) return { path: path.resolve(process.env.LOCAL_MODELS_DIR), source: "env" };
  if (state.dir) return state.dir;
  const fallback = path.join(process.cwd(), "data", "models");
  let chosen: { path: string; source: "env" | "auto" | "default" } = { path: fallback, source: "default" };
  if (process.platform === "win32") {
    const here = (await freeBytes(process.cwd())) ?? 0;
    if (here < 6e9) {
      let best = { drive: "", free: here };
      for (const letter of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
        const root = `${letter}:\\`;
        if (!existsSync(root)) continue;
        const free = (await freeBytes(root)) ?? 0;
        if (free > best.free) best = { drive: root, free };
      }
      if (best.drive && path.parse(process.cwd()).root.toUpperCase() !== best.drive.toUpperCase()) {
        chosen = { path: path.join(best.drive, "BookByThePeople", "models"), source: "auto" };
      }
    }
  }
  state.dir = chosen;
  return chosen;
}

export async function freeBytes(target: string): Promise<number | null> {
  try {
    let probe = target;
    while (!existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
    const info = await statfs(probe);
    return Number(info.bavail) * Number(info.bsize);
  } catch {
    return null;
  }
}

function runtimeDir(dir: string) {
  return path.join(dir, "runtime", LLAMA_CPP_BUILD);
}

function findServerBinary(root: string): string | null {
  if (!existsSync(root)) return null;
  const want = process.platform === "win32" ? "llama-server.exe" : "llama-server";
  const stack = [root];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === want) return full;
    }
  }
  return null;
}

export function ggufPath(dir: string, model: LocalModel) {
  return path.join(dir, "gguf", model.file);
}

function isGguf(file: string): boolean {
  try {
    const fd = openSync(file, "r");
    const head = Buffer.alloc(4);
    readSync(fd, head, 0, 4, 0);
    closeSync(fd);
    return head.toString("latin1") === "GGUF";
  } catch {
    return false;
  }
}

export function modelInstalled(dir: string, model: LocalModel): boolean {
  const file = ggufPath(dir, model);
  return existsSync(file) && statSync(file).size === model.bytes;
}

export function runtimeInstalled(dir: string): boolean {
  return Boolean(findServerBinary(runtimeDir(dir)));
}

export function currentJob(): LocalJob | null {
  if (!state.job) return null;
  const { abort: _abort, ...job } = state.job;
  void _abort;
  return job;
}

export function runningModel(): { modelId: string; port: number } | null {
  if (!state.server || state.server.child.exitCode !== null) return null;
  return { modelId: state.server.modelId, port: state.server.port };
}

/** Streams a URL to a file with resume and progress. */
async function download(url: string, dest: string, signal: AbortSignal, onBytes: (received: number, total: number) => void) {
  mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  const offset = existsSync(part) ? statSync(part).size : 0;
  const response = await fetch(url, { signal, headers: offset ? { Range: `bytes=${offset}-` } : {}, redirect: "follow" });
  if (!response.ok && response.status !== 206) throw new Error(`Download failed (HTTP ${response.status}).`);
  if (!response.body) throw new Error("Download returned no data.");
  const resumed = response.status === 206 && offset > 0;
  const length = Number(response.headers.get("content-length") || 0);
  const total = (resumed ? offset : 0) + length;
  let received = resumed ? offset : 0;
  onBytes(received, total);
  const source = Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>);
  source.on("data", (chunk: Buffer) => {
    received += chunk.length;
    onBytes(received, total);
  });
  await pipeline(source, createWriteStream(part, { flags: resumed ? "a" : "w" }), { signal });
  renameSync(part, dest);
}

function extract(archive: string, into: string): Promise<void> {
  mkdirSync(into, { recursive: true });
  // tar ships with macOS, Linux and Windows 10+ (bsdtar, which also reads .zip).
  return new Promise((resolve, reject) => {
    execFile("tar", ["-xf", archive, "-C", into], (error) => (error ? reject(new Error(`Could not unpack llama.cpp: ${error.message}`)) : resolve()));
  });
}

function setJob(patch: Partial<LocalJob>) {
  if (state.job) Object.assign(state.job, patch);
}

export async function ensureRuntime(dir: string, signal: AbortSignal) {
  if (runtimeInstalled(dir)) return;
  const asset = assetName();
  if (!asset) throw new Error(`No llama.cpp build for ${process.platform}/${process.arch}. Install Ollama instead.`);
  const url = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_BUILD}/${asset}`;
  const archive = path.join(dir, "runtime", asset);
  setJob({ phase: "runtime", received: 0, total: 0, message: "Getting the llama.cpp runtime" });
  await download(url, archive, signal, (received, total) => setJob({ received, total }));
  await extract(archive, runtimeDir(dir));
  rmSync(archive, { force: true });
  const binary = findServerBinary(runtimeDir(dir));
  if (!binary) throw new Error("llama-server was not found in the download.");
  if (process.platform !== "win32") chmodSync(binary, 0o755);
}

async function waitHealthy(port: number, child: ChildProcess, timeoutMs = 180_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) throw new Error("The local model stopped while starting. It may need more free RAM.");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch {
      // still loading
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("The local model took too long to start.");
}

export function stopServer() {
  if (state.server && state.server.child.exitCode === null) state.server.child.kill();
  state.server = null;
}

/** Starts llama-server for a model (or reuses the running one). */
export async function ensureServer(modelId: string): Promise<{ port: number }> {
  const model = localModelById(modelId);
  if (!model) throw new Error(`Unknown local model ${modelId}.`);
  if (state.server && state.server.child.exitCode === null && state.server.modelId === model.id) {
    await state.server.ready;
    return { port: state.server.port };
  }
  stopServer();
  // A llama-server left over from an earlier `next dev` run is reused when it serves this model.
  try {
    const probe = await fetch(`http://127.0.0.1:${LOCAL_PORT}/v1/models`, { signal: AbortSignal.timeout(1500) });
    if (probe.ok) {
      const data = (await probe.json()) as { data?: { id: string }[] };
      if (data.data?.some((item) => item.id === model.id)) return { port: LOCAL_PORT };
      throw new Error(`Port ${LOCAL_PORT} is busy with another model. Stop it, or set LOCAL_MODEL_PORT.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Port ")) throw error;
  }
  const { path: dir } = await modelsDir();
  const binary = findServerBinary(runtimeDir(dir));
  if (!binary) throw new Error("The local runtime is not downloaded yet. Open Book settings → Local models.");
  const gguf = ggufPath(dir, model);
  if (!existsSync(gguf)) throw new Error(`${model.name} is not downloaded yet. Open Book settings → Local models.`);
  const threads = String(Math.max(2, Math.min(8, os.cpus().length - 1)));
  const libDir = path.dirname(binary);
  const child = spawn(
    binary,
    ["-m", gguf, "--host", "127.0.0.1", "--port", String(LOCAL_PORT), "-c", process.env.LOCAL_MODEL_CTX || "8192", "-t", threads, "--alias", model.id, "--no-webui"],
    {
      cwd: libDir,
      env: {
        ...process.env,
        LD_LIBRARY_PATH: [libDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter),
        DYLD_LIBRARY_PATH: [libDir, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(path.delimiter),
      },
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    },
  );
  let tail = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    tail = (tail + chunk.toString("utf8")).slice(-2000);
  });
  const ready = waitHealthy(LOCAL_PORT, child).catch((error: Error) => {
    child.kill();
    const hint = /unknown argument.*no-webui/i.test(tail) ? "" : tail.split("\n").filter(Boolean).slice(-2).join(" ");
    throw new Error(`${error.message}${hint ? ` (${hint.slice(0, 240)})` : ""}`);
  });
  state.server = { child, modelId: model.id, port: LOCAL_PORT, ready };
  child.on("exit", () => {
    if (state.server?.child === child) state.server = null;
  });
  await ready;
  return { port: LOCAL_PORT };
}

const hooks = globalThis as unknown as { __bbtpLocalExitHook?: boolean };
if (!hooks.__bbtpLocalExitHook) {
  hooks.__bbtpLocalExitHook = true;
  // Do not leave llama-server running after `next dev` stops.
  for (const signal of ["exit", "SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      stopServer();
      if (signal !== "exit") process.exit(0);
    });
  }
}

export async function ollamaInfo(): Promise<{ running: boolean; version: string; models: string[] }> {
  try {
    const version = await fetch(`${OLLAMA_URL}/api/version`, { signal: AbortSignal.timeout(1200) });
    if (!version.ok) return { running: false, version: "", models: [] };
    const tags = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) }).then((r) => r.json() as Promise<{ models?: { name: string }[] }>).catch(() => ({ models: [] as { name: string }[] }));
    return { running: true, version: ((await version.json()) as { version?: string }).version ?? "", models: (tags.models ?? []).map((item) => item.name) };
  } catch {
    return { running: false, version: "", models: [] };
  }
}

async function pullWithOllama(model: LocalModel, signal: AbortSignal) {
  setJob({ phase: "model", received: 0, total: model.ollamaBytes, message: `Pulling ${model.ollama} with Ollama` });
  const response = await fetch(`${OLLAMA_URL}/api/pull`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: model.ollama, stream: true }),
  });
  if (!response.ok || !response.body) throw new Error(`Ollama pull failed (HTTP ${response.status}).`);
  const layers = new Map<string, { total: number; completed: number }>();
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as { status?: string; digest?: string; total?: number; completed?: number; error?: string };
      if (event.error) throw new Error(`Ollama: ${event.error}`);
      if (event.digest && event.total) layers.set(event.digest, { total: event.total, completed: event.completed ?? 0 });
      const total = [...layers.values()].reduce((sum, layer) => sum + layer.total, 0);
      const done = [...layers.values()].reduce((sum, layer) => sum + layer.completed, 0);
      setJob({ received: done, total: total || model.ollamaBytes, message: event.status ? `Ollama: ${event.status}` : "Pulling with Ollama" });
    }
  }
}

/**
 * Starts a background download. `after` registers the provider and runs a test;
 * it is awaited inside the job so the UI sees "testing" then "done".
 */
export function startDownload(
  modelId: string,
  engine: "builtin" | "ollama",
  after: (model: LocalModel) => Promise<string>,
): LocalJob {
  const model = localModelById(modelId);
  if (!model) throw new Error("Pick a model from the list.");
  if (state.job && ["runtime", "model", "starting", "testing"].includes(state.job.phase)) {
    throw new Error("A download is already running. Cancel it first.");
  }
  const abort = new AbortController();
  state.job = { modelId: model.id, engine, phase: "model", received: 0, total: engine === "builtin" ? model.bytes : model.ollamaBytes, message: "Starting", startedAt: Date.now(), abort };
  void (async () => {
    try {
      if (engine === "ollama") {
        await pullWithOllama(model, abort.signal);
      } else {
        const { path: dir } = await modelsDir();
        const free = await freeBytes(dir);
        const need = (modelInstalled(dir, model) ? 0 : model.bytes) + (runtimeInstalled(dir) ? 0 : 60e6);
        if (free !== null && free < need + 200e6) {
          throw new Error(`Not enough space in ${dir}: ${(free / 1e9).toFixed(1)} GB free, ${(need / 1e9).toFixed(1)} GB needed. Set LOCAL_MODELS_DIR to a bigger drive.`);
        }
        await ensureRuntime(dir, abort.signal);
        if (!modelInstalled(dir, model)) {
          setJob({ phase: "model", received: 0, total: model.bytes, message: `Downloading ${model.name}` });
          const url = `https://huggingface.co/${model.repo}/resolve/main/${model.file}?download=true`;
          await download(url, ggufPath(dir, model), abort.signal, (received, total) => setJob({ received, total: total || model.bytes }));
          if (!isGguf(ggufPath(dir, model))) {
            rmSync(ggufPath(dir, model), { force: true });
            throw new Error("The downloaded file is not a GGUF model. Try again.");
          }
        }
        setJob({ phase: "starting", message: `Starting ${model.name}`, received: model.bytes, total: model.bytes });
        await ensureServer(model.id);
      }
      setJob({ phase: "testing", message: "Testing" });
      const message = await after(model);
      setJob({ phase: "done", message });
    } catch (error) {
      if (abort.signal.aborted) setJob({ phase: "cancelled", message: "Cancelled. The partial file is kept so the next try resumes." });
      else setJob({ phase: "error", message: error instanceof Error ? error.message : "The download failed." });
    }
  })();
  return currentJob()!;
}

export function cancelDownload() {
  state.job?.abort?.abort();
}

export function clearJob() {
  if (state.job && !["runtime", "model", "starting", "testing"].includes(state.job.phase)) state.job = null;
}

/** Deletes a downloaded GGUF (and its partial file). Ollama models are left to Ollama. */
export async function removeModel(modelId: string) {
  const model = localModelById(modelId);
  if (!model) return;
  if (state.server?.modelId === model.id) stopServer();
  const { path: dir } = await modelsDir();
  rmSync(ggufPath(dir, model), { force: true });
  rmSync(`${ggufPath(dir, model)}.part`, { force: true });
}

export { LOCAL_MODELS };
