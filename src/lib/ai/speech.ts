import "server-only";
import { getConfig } from "../config";
import { LANGUAGES } from "../languages";
import { bookAiKey } from "./keys";
import { firstThatWorks, transcribeWav, type CallTarget } from "./provider-client";
import { canTranscribe } from "./provider-store";
import { prepare, providerTag, transcriberChain, writerChain } from "./providers";
import type { ResolvedProvider } from "./provider-store";

/**
 * Live speech-to-text for the Add your voice page. Each short clip goes to the book creator's own
 * AI provider and only the words come back. The audio lives in memory for this one request: it is never
 * written to the database, storage, a temp file or a log.
 */

/** The creator's speech models: ones marked for transcription first, else their writing model when it can also hear. */
async function speechChain(bookId: string): Promise<ResolvedProvider[]> {
  const hearers = await transcriberChain(bookId).catch(() => []);
  if (hearers.length) return hearers;
  const writers = await writerChain(bookId).catch(() => []);
  return writers.filter((item) => item.type !== "custom" && canTranscribe(item.type));
}

/** A book's own pasted Meta key, or the server's key when it runs live. */
async function metaFallback(bookId: string): Promise<CallTarget | null> {
  const cfg = getConfig();
  const apiKey = await bookAiKey(bookId).catch(() => "");
  if (!apiKey) return null;
  return { label: "Meta", type: "meta", baseUrl: cfg.metaBaseUrl, model: cfg.transcribeModel, apiKey };
}

export async function speechAvailable(bookId: string): Promise<boolean> {
  if ((await speechChain(bookId)).length) return true;
  return Boolean(await metaFallback(bookId));
}

export class NoSpeechModel extends Error {
  constructor() {
    super("This book has no speech model.");
  }
}

export async function transcribeClip(input: { bookId: string; wav: Buffer; language: string }): Promise<{ text: string; provider: string; model: string; ms: number }> {
  const lang = LANGUAGES.find((item) => item.code === input.language);
  const languageName = input.language === "hinglish" ? "" : lang?.muse ?? "";
  const languageCode = /^[a-z]{2}$/.test(input.language) ? input.language : "";
  const options = { wav: input.wav, languageName, languageCode, keywords: [], mode: "PUSH_TO_TALK" };
  const chain = await speechChain(input.bookId);
  if (chain.length) {
    const { result, provider } = await firstThatWorks(chain, async (item) => transcribeWav(await prepare(item), options));
    return { text: result.transcript, provider: providerTag(provider), model: result.model, ms: result.audioDurationMs };
  }
  const meta = await metaFallback(input.bookId);
  if (!meta) throw new NoSpeechModel();
  const result = await transcribeWav({ ...meta, transcribeModel: meta.model }, options);
  return { text: result.transcript, provider: "meta", model: result.model, ms: result.audioDurationMs };
}
