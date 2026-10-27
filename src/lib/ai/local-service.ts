import "server-only";
import os from "node:os";
import { prisma } from "../db";
import { LOCAL_MODELS, type LocalModel, type LocalStatus } from "./local-catalog";
import {
  LLAMA_CPP_BUILD,
  LOCAL_PORT,
  OLLAMA_URL,
  cancelDownload,
  clearJob,
  currentJob,
  freeBytes,
  modelInstalled,
  modelsDir,
  ollamaInfo,
  removeModel,
  runningModel,
  runtimeInstalled,
  startDownload,
} from "./local-runtime";
import { providerStore, testProvider } from "./providers";

export async function localStatus(userId: string): Promise<LocalStatus> {
  const dir = await modelsDir();
  const [free, ollama, providers] = await Promise.all([
    freeBytes(dir.path),
    ollamaInfo(),
    prisma.aiProvider.findMany({ where: { userId, type: { in: ["local", "ollama"] } }, select: { id: true, type: true, localModel: true, model: true } }),
  ]);
  const supported = ["win32", "darwin", "linux"].includes(process.platform);
  return {
    dir: dir.path,
    dirSource: dir.source,
    freeBytes: free,
    platform: `${process.platform}-${process.arch}`,
    ramGb: Math.round(os.totalmem() / 1024 ** 3),
    runtime: { installed: runtimeInstalled(dir.path), build: LLAMA_CPP_BUILD, supported },
    ollama: { ...ollama, url: OLLAMA_URL },
    running: runningModel(),
    models: LOCAL_MODELS.map((model) => ({
      ...model,
      installed: modelInstalled(dir.path, model),
      inOllama: Boolean(model.ollama) && ollama.models.some((name) => name === model.ollama || name === `${model.ollama}:latest`),
      providerId:
        providers.find((row) => row.type === "local" && row.localModel === model.id)?.id ??
        providers.find((row) => row.type === "ollama" && (row.localModel === model.id || (model.ollama !== "" && row.model === model.ollama)))?.id ??
        null,
    })),
    job: currentJob(),
  };
}

/** Adds (or refreshes) the provider for a downloaded model, puts it first, and tests it. */
async function register(userId: string, model: LocalModel, engine: "builtin" | "ollama"): Promise<string> {
  const type = engine === "builtin" ? "local" : "ollama";
  const existing = await prisma.aiProvider.findFirst({ where: { userId, type, localModel: model.id } });
  let id = existing?.id;
  if (!id) {
    const view = await providerStore.create(userId, {
      type,
      label: model.name,
      baseUrl: engine === "builtin" ? `http://127.0.0.1:${LOCAL_PORT}/v1` : `${OLLAMA_URL}/v1`,
      model: engine === "builtin" ? model.id : model.ollama,
      role: "writer",
      localModel: model.id,
    });
    id = view.id;
  } else if (existing && !existing.enabled) {
    await providerStore.update(userId, id, { enabled: true });
  }
  const others = (await providerStore.list(userId)).map((item) => item.id).filter((item) => item !== id);
  await providerStore.reorder(userId, [id, ...others]);
  const test = await testProvider(userId, id);
  if (!test.ok) throw new Error(`Downloaded, but the test failed: ${test.message}`);
  return `Ready. ${test.message}`;
}

export async function localAction(userId: string, body: { action?: string; modelId?: string; engine?: string }) {
  switch (body.action) {
    case "download": {
      const engine = body.engine === "ollama" ? "ollama" : "builtin";
      if (engine === "ollama" && !(await ollamaInfo()).running) throw new Error("Ollama is not running. Start it, or use the built-in download.");
      return startDownload(body.modelId ?? "", engine, (model) => register(userId, model, engine));
    }
    case "cancel":
      cancelDownload();
      return currentJob();
    case "clear":
      clearJob();
      return null;
    case "remove": {
      await removeModel(body.modelId ?? "");
      await prisma.aiProvider.deleteMany({ where: { userId, type: "local", localModel: body.modelId ?? "" } });
      return null;
    }
    default:
      throw new Error("Unknown action.");
  }
}
