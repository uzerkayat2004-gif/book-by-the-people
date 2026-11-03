/** Plain text helpers for the Meta voice. No server imports, so tests and Studio can use them. */

export type Pause = "none" | "short" | "long";
export type Segment = { text: string; pause: Pause };
export type ChapterScript = { title: string; segments: Segment[] };

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** 0..999,999,999 in English words. */
export function numberWords(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 999_999_999) return String(value);
  const n = Math.floor(value);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "");
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${numberWords(n % 100)}` : ""}`;
  if (n < 1_000_000) return `${numberWords(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${numberWords(n % 1000)}` : ""}`;
  return `${numberWords(Math.floor(n / 1_000_000))} million${n % 1_000_000 ? ` ${numberWords(n % 1_000_000)}` : ""}`;
}

/** Makes English text speakable by MMS (its alphabet has no punctuation and few digits). */
export function speakableEnglish(text: string): string {
  return text
    .replace(/(\d+)%/g, (_, d: string) => `${numberWords(Number(d))} percent`)
    .replace(/(\d{1,3}(?:,\d{3})+|\d+)/g, (m) => numberWords(Number(m.replace(/,/g, ""))))
    .replace(/&/g, " and ")
    .replace(/[“”"«»]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits text into sentences, then packs them into pieces of at most `max` characters. */
export function sentencePieces(text: string, max = 320): string[] {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?…।؟。])\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= max) {
      out.push(sentence);
      continue;
    }
    // A very long sentence is cut at commas, then at spaces.
    let rest = sentence;
    while (rest.length > max) {
      let cut = rest.lastIndexOf(", ", max);
      if (cut < max / 3) cut = rest.lastIndexOf(" ", max);
      if (cut < max / 3) cut = max;
      out.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 1).trim();
    }
    if (rest) out.push(rest);
  }
  return out;
}

export type VitsTokenizer = { vocab: Record<string, number>; keep: RegExp; lower: boolean; pad: number; unk: number };

/** Builds the MMS (VITS) tokenizer from its tokenizer.json. */
export function tokenizerFrom(json: string): VitsTokenizer {
  const data = JSON.parse(json) as {
    model: { vocab: Record<string, number> };
    normalizer?: { normalizers?: { type: string; pattern?: { Regex?: string } }[] };
    added_tokens?: { id: number; content: string }[];
  };
  const steps = data.normalizer?.normalizers ?? [];
  const lower = steps.some((s) => s.type === "Lowercase");
  const filter = steps.find((s) => s.type === "Replace" && s.pattern?.Regex?.startsWith("[^"));
  const keep = new RegExp(filter?.pattern?.Regex ?? "[^\\s\\S]", "gu");
  const unk = data.added_tokens?.find((t) => t.content === "<unk>")?.id ?? 0;
  // The pad token is id 0 in every MMS vocabulary; blanks between letters use it.
  return { vocab: data.model.vocab, keep, lower, pad: 0, unk };
}

/** Text → MMS input ids: normalise, drop unknown characters, put a blank between every character. */
export function tokenize(tok: VitsTokenizer, text: string): number[] {
  let clean = text.normalize("NFC");
  if (tok.lower) clean = clean.toLowerCase();
  clean = clean.replace(tok.keep, "").replace(/\s+/g, " ").trim();
  const ids = [tok.pad];
  for (const ch of clean) ids.push(tok.vocab[ch] ?? tok.unk, tok.pad);
  return ids.length > 1 ? ids : [];
}

export const PAUSE_MS: Record<Pause, number> = { none: 220, short: 450, long: 900 };
