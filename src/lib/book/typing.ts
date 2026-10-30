/**
 * How a voice was given: typed, pasted or spoken, and for how long. Stored with the voice for
 * its duration and the creator's view. It never holds a voice back; the AI check decides.
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

export type InputSignal = { mode: InputMode; activeMs: number; keys: number; chars: number; spoken: number };

export function inputSignal(mode: InputMode, text: string, raw: Partial<InputMetrics>): InputSignal {
  const chars = text.replace(/\s+/g, " ").trim().length;
  const activeMs = Math.max(0, Math.round(Number(raw.activeMs) || 0));
  const keys = Math.max(0, Math.round(Number(raw.keys) || 0));
  const spoken = Math.max(0, Math.round(Number(raw.spoken) || 0));
  return { mode, activeMs, keys, chars, spoken };
}
