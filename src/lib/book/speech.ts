import type { Turn } from "./types";

const ENGLISH_WORDS = new Set(
  `the and that this with from have has was were are been being for you your our their they them she her his its not but about into over after before than then too very can could should would what when who how which just like make makes made making because really also more most some any only other than into onto upon such same still even back well much many more out off all one two people time work think use used using know want need feel something anything everything someone about when your you're its it's dont don't isn't wasn't didn't can't won't i'm ive i've smarter lazier draft answer question memory learn learning faster slower check checking write writing think thinking life work office night weekend small trade`.split(
    /\s+/,
  ),
);

export function normalizeSpeech(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The start word has to be spoken at the beginning, not buried later. */
export function spokenStartWord(transcript: string, startWord: string): boolean {
  const spoken = normalizeSpeech(transcript);
  const target = normalizeSpeech(startWord);
  if (!spoken || !target) return false;
  if (spoken.startsWith(target)) return true;

  const words = spoken.split(" ").filter(Boolean);
  const parts = target.split(" ").filter(Boolean);
  const window = words.slice(0, 6);
  for (let i = 0; i <= window.length - parts.length; i += 1) {
    if (parts.every((part, index) => window[i + index] === part)) return true;
  }

  const compact = spoken.replace(/\s/g, "");
  const compactTarget = target.replace(/\s/g, "");
  const head = compact.slice(0, Math.max(20, compactTarget.length + 4));
  return head.includes(compactTarget);
}

export function isMostlyEnglish(text: string): boolean {
  const letters = [...text].filter((character) => /\p{L}/u.test(character));
  if (letters.length === 0) return true;
  const latin = letters.filter((character) => /\p{Script=Latin}/u.test(character)).length;
  if (latin / letters.length < 0.8) return false;

  const words = text
    .toLowerCase()
    .split(/[^a-z']+/)
    .filter((word) => word.length > 1);
  if (words.length === 0) return false;
  let hits = 0;
  for (const word of words) {
    if (ENGLISH_WORDS.has(word)) hits += 1;
  }
  return hits / words.length >= 0.45;
}

/** Whether words in `language` need translating into the book's main language (`target`, English by default). */
export function shouldTranslate(language: string, text: string, target = "en"): boolean {
  const code = language.toLowerCase();
  const goal = (target || "en").toLowerCase();
  if (!text.trim()) return false;
  if (goal === "en") {
    if (code === "en" || code === "english" || code === "hinglish") return false;
    if (isMostlyEnglish(text)) return false;
    return true;
  }
  return code !== goal;
}

export function splitSentences(text: string): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const parts = cleaned
    .split(/(?<=[.!?。！？])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [cleaned];
}

export function bestQuote(text: string, startWord: string | null, kind: "voice" | "sourced_quote" = "voice"): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (kind === "sourced_quote") {
    const words = cleaned.split(/\s+/).length;
    if (words <= 80) return cleaned;
  }

  const sentences = splitSentences(cleaned).filter((sentence) => {
    const words = sentence.split(/\s+/).filter(Boolean);
    if (!startWord) return words.length >= 4 || sentence.length >= 12;
    const same = normalizeSpeech(sentence) === normalizeSpeech(startWord);
    const onlyWord =
      words.length <= 3 && normalizeSpeech(sentence).includes(normalizeSpeech(startWord));
    if (same || onlyWord) return false;
    return words.length >= 4 || sentence.length >= 12;
  });
  const pool = sentences.length > 0 ? sentences : splitSentences(cleaned);
  let best = pool[0] ?? cleaned;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const sentence of pool) {
    const words = sentence.split(/\s+/).filter(Boolean).length;
    let score = 0;
    if (words >= 8 && words <= 40) score += 5;
    else if (words >= 5 && words <= 50) score += 3;
    else score -= 2;
    if (/\b(i|i'm|we|because|when|but)\b/i.test(sentence)) score += 2;
    if (startWord && normalizeSpeech(sentence).startsWith(normalizeSpeech(startWord))) score -= 3;
    if (score > bestScore) {
      bestScore = score;
      best = sentence;
    }
  }
  return best;
}

export function snapToVerbatim(candidate: string, original: string): string | null {
  const wanted = candidate.trim();
  if (!wanted) return null;
  if (original.includes(wanted)) return wanted;
  const index = original.toLowerCase().indexOf(wanted.toLowerCase());
  if (index >= 0) return original.slice(index, index + wanted.length);
  return null;
}

export function locateSpan(
  turns: Turn[],
  fullText: string,
  quote: string,
  durationMs: number,
): { startMs: number; endMs: number } {
  const snippet = quote.trim();
  const duration = Math.max(0, durationMs);
  if (!snippet) return { startMs: 0, endMs: Math.min(duration || 0, 1500) };

  const turn =
    turns.find((item) => item.transcript.includes(snippet)) ??
    turns.find((item) => normalizeSpeech(item.transcript).includes(normalizeSpeech(snippet)));

  if (turn && turn.transcript.trim()) {
    const direct = turn.transcript.toLowerCase().indexOf(snippet.toLowerCase());
    const startIndex = direct >= 0 ? direct : 0;
    const span = Math.max(1, turn.endMs - turn.startMs);
    const ratio = startIndex / Math.max(1, turn.transcript.length);
    const width = Math.max(0.15, snippet.length / Math.max(1, turn.transcript.length));
    const startMs = Math.round(turn.startMs + ratio * span);
    const endMs = Math.min(turn.endMs, Math.round(startMs + width * span));
    return { startMs, endMs: Math.max(endMs, Math.min(turn.endMs, startMs + 400)) };
  }

  const index = fullText.toLowerCase().indexOf(snippet.toLowerCase());
  const dur = Math.max(duration, 1000);
  if (index >= 0 && fullText.length > 0) {
    const ratio = index / fullText.length;
    const width = Math.max(0.12, snippet.length / fullText.length);
    const startMs = Math.round(ratio * dur);
    const endMs = Math.min(dur, Math.round(startMs + width * dur));
    return { startMs, endMs: Math.max(endMs, startMs + 400) };
  }
  return { startMs: 0, endMs: dur };
}

export function wavDurationMs(buffer: Buffer): number | null {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF") return null;
  let offset = 12;
  let sampleRate = 0;
  let channels = 1;
  let bits = 16;
  let dataBytes = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt " && start + 16 <= buffer.length) {
      channels = buffer.readUInt16LE(start + 2) || 1;
      sampleRate = buffer.readUInt32LE(start + 4);
      bits = buffer.readUInt16LE(start + 14) || 16;
    } else if (id === "data") {
      dataBytes = size;
      break;
    }
    offset = start + size + (size % 2);
  }
  if (!sampleRate || !dataBytes) return null;
  const bytesPerSample = Math.max(1, (bits / 8) * channels);
  return Math.round((dataBytes / bytesPerSample / sampleRate) * 1000);
}

/** The start word proves a live take; it is not part of what the person meant to say. */
export function dropStartWord(text: string, startWord: string | null | undefined): string {
  if (!startWord) return text;
  const target = normalizeSpeech(startWord);
  if (!target) return text;
  const parts = target.split(" ").filter(Boolean).length;
  const tokens = text.trimStart().split(/\s+/);
  const head = normalizeSpeech(tokens.slice(0, parts).join(" "));
  if (head !== target) return text;
  const rest = tokens.slice(parts).join(" ").replace(/^[\s.,;:!?…—–-]+/u, "");
  if (!rest) return text;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}
