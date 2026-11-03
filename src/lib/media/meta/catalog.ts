/**
 * What the Meta audiobook and video book can use. Shared by Studio (pickers) and the server, so no server-only imports.
 *
 * Meta's hosted Model API has no text-to-speech, so the voice is Meta's own open MMS-TTS model
 * (facebook/mms-tts-<lang>, CC-BY-NC 4.0), run on our server. Only languages with a working ONNX copy are listed.
 */

export type VoiceEngine = "meta-mms" | "espeak";

export type VoiceOption = { id: string; engine: VoiceEngine; language: string; label: string; recommended: boolean };

/** App language code → MMS-TTS language code. Japanese, Italian and Chinese have no MMS-TTS model. */
export const MMS_LANGUAGES: Record<string, { code: string; name: string }> = {
  en: { code: "eng", name: "English" },
  hi: { code: "hin", name: "Hindi" },
  es: { code: "spa", name: "Spanish" },
  fr: { code: "fra", name: "French" },
  de: { code: "deu", name: "German" },
  ar: { code: "ara", name: "Arabic" },
  ru: { code: "rus", name: "Russian" },
  pt: { code: "por", name: "Portuguese" },
  vi: { code: "vie", name: "Vietnamese" },
  ro: { code: "ron", name: "Romanian" },
  yo: { code: "yor", name: "Yoruba" },
};

export function baseLanguage(code: string): string {
  return (code || "en").toLowerCase().split(/[-_]/)[0];
}

export function mmsFor(language: string): { code: string; name: string } | null {
  return MMS_LANGUAGES[baseLanguage(language)] ?? null;
}

/** Voices for one language. Meta first (Recommended); eSpeak only when non-Meta options are allowed. */
export function voiceOptions(language: string, metaOnly: boolean): VoiceOption[] {
  const out: VoiceOption[] = [];
  const mms = mmsFor(language);
  if (mms) out.push({ id: `mms-${mms.code}`, engine: "meta-mms", language, label: `Meta MMS-TTS · ${mms.name}`, recommended: true });
  if (!metaOnly) out.push({ id: "espeak", engine: "espeak", language, label: "Built-in voice (eSpeak)", recommended: !mms });
  return out;
}

/** Text models Meta recommends for writing, best first. */
export const META_WRITERS = ["muse-spark-1.3", "muse-wonder-1.0", "muse-spark-1.3-contributor", "muse-spark-1.2", "muse-spark-1.2-contributor"];
export const META_WRITER_RECOMMENDED = "muse-spark-1.3";
export const META_IMAGE_MODELS = ["muse-image-1.0"];

/** Is this Meta model id a text writer? (Image, voice and segmentation models are not.) */
export function isMetaWriter(id: string): boolean {
  return /^muse-(spark|wonder)/i.test(id);
}
export function isMetaImage(id: string): boolean {
  return /^muse-image/i.test(id);
}

export type ModelOption = {
  /** "<targetId>::<model>" */
  value: string;
  targetId: string;
  model: string;
  label: string;
  provider: string;
  recommended: boolean;
  usable: boolean;
  note?: string;
};

export type AudiobookPicks = { writer: string; voices: Record<string, string>; music?: boolean };
export type MediaPicks = { audiobook: AudiobookPicks };

export const EMPTY_PICKS: MediaPicks = { audiobook: { writer: "", voices: {} } };
