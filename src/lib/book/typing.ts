/**
 * A light, non-blocking honesty signal for typed or dictated words.
 * Nothing is refused because of it: a flagged voice just waits for the creator to look.
 */
export type InputMode = "speak" | "write";

export type InputMetrics = {
  /** Milliseconds the person was actively typing or dictating. */
  activeMs: number;
  /** Keys pressed in the box (letters, spaces, deletes). */
  keys: number;
  /** Characters that came from speech-to-text. */
  spoken: number;
};

export type InputSignal = { mode: InputMode; activeMs: number; keys: number; chars: number; spoken: number; fast: boolean; why: string };

/** Fast typists manage ~12 characters a second in bursts; dictation runs ~20. Well past that means the words came from elsewhere. */
const MAX_TYPED_CPS = 14;
const MAX_SPOKEN_CPS = 30;

export function inputSignal(mode: InputMode, text: string, raw: Partial<InputMetrics>): InputSignal {
  const chars = text.replace(/\s+/g, " ").trim().length;
  const activeMs = Math.max(0, Math.round(Number(raw.activeMs) || 0));
  const keys = Math.max(0, Math.round(Number(raw.keys) || 0));
  const spoken = Math.max(0, Math.round(Number(raw.spoken) || 0));
  const seconds = Math.max(activeMs / 1000, 0.5);
  let why = "";
  if (chars >= 80) {
    // Words that neither keys nor speech account for.
    const explained = keys + spoken;
    if (explained < chars * 0.5) why = "Most of the words were not typed or spoken here.";
    else if (mode === "write" && chars / seconds > MAX_TYPED_CPS && spoken < chars * 0.3) why = "Typed unusually fast.";
    else if (mode === "speak" && chars / seconds > MAX_SPOKEN_CPS) why = "Came in faster than anyone speaks.";
  }
  return { mode, activeMs, keys, chars, spoken, fast: Boolean(why), why };
}
