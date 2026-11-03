import "server-only";
import { writeFeature, type Ask } from "../book/feature";
import type { BookDocument, SourceVoice } from "../book/types";
import { getConfig } from "../config";
import { languageByCode } from "../languages";
import { recordUsage } from "../services/spend";
import { getAudio, putAudio } from "../storage";
import { extractJson } from "./index";
import { completeJson } from "./meta";

/** Writes the book with the feature writer (map → reduce → plan → write → edit) on the book's writer model. */
export async function writeFeatureBook(input: {
  title: string;
  question: string;
  bookType: string;
  voices: SourceVoice[];
  bookId: string;
  language: string;
  log?: (line: string) => void;
  deadline?: number;
}): Promise<BookDocument> {
  let provider = "meta";
  let model = getConfig().writerModel;
  const ask: Ask = async (call) => {
    const result = await completeJson({
      system: call.system,
      user: call.user,
      schemaName: call.schemaName,
      schema: call.schema,
      bookId: input.bookId,
      maxTokens: call.maxTokens,
    });
    provider = result.provider;
    model = result.model;
    await recordUsage({
      kind: "compose",
      provider: result.provider,
      model: result.model,
      bookId: input.bookId,
      usage: result.usage,
    }).catch(() => undefined);
    return extractJson(result.content);
  };
  const prefix = `book-${input.bookId}-feature-`;
  const document = await writeFeature({
    title: input.title,
    question: input.question,
    bookType: input.bookType,
    language: input.language,
    languageName: languageByCode(input.language).name,
    voices: input.voices,
    ask,
    cache: {
      get: async (key) =>
        JSON.parse((await getAudio(prefix + key + ".json")).toString("utf8")),
      put: (key, value) =>
        putAudio(
          prefix + key + ".json",
          Buffer.from(JSON.stringify(value)),
          "application/json",
        ),
    },
    log: input.log,
    deadline: input.deadline,
    provider,
    model,
  });
  document.provider = provider;
  document.model = model;
  return document;
}
