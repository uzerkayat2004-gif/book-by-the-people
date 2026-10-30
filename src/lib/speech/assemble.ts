/** Puts transcribed clips back in spoken order and joins them onto whatever the person has typed. */

/** Joins a new phrase onto the text with one space and a capital at sentence starts. */
export function joinPhrase(text: string, phrase: string): string {
  const clean = phrase.replace(/\s+/g, " ").trim();
  if (!clean) return text;
  const base = text.replace(/\s+$/, "");
  if (!base) return clean.charAt(0).toUpperCase() + clean.slice(1);
  const capital = /[.!?]$/.test(base) ? clean.charAt(0).toUpperCase() + clean.slice(1) : clean;
  return `${base} ${capital}`;
}

const word = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

/** Drops words at the start of `next` that only repeat the last words of `text` (a clip boundary heard twice). */
export function dropOverlap(text: string, next: string, maxWords = 6): string {
  const tail = text.trim().split(/\s+/).filter(Boolean).slice(-maxWords).map(word);
  const head = next.trim().split(/\s+/).filter(Boolean);
  for (let size = Math.min(maxWords, tail.length, head.length); size >= 2; size -= 1) {
    const a = tail.slice(-size).join(" ");
    const b = head.slice(0, size).map(word).join(" ");
    if (a && a === b) return head.slice(size).join(" ");
  }
  return next.trim();
}

/** Things speech models say about silence or noise instead of words. */
const NOISE = /^[\s.,!?…-]*(\[[^\]]*\]|\([^)]*\)|thank you\.?|thanks for watching!?|you|bye\.?|\.+)?[\s.,!?…-]*$/i;

export function cleanClipText(text: string, voicedMs: number): string {
  const clean = text.replace(/\s+/g, " ").replace(/^["“]|["”]$/g, "").trim();
  if (!clean) return "";
  if (/^\[[^\]]*\]$|^\([^)]*\)$/.test(clean)) return "";
  if (voicedMs < 1200 && NOISE.test(clean)) return "";
  return clean;
}

/**
 * Clips finish out of order. `settle` records a clip's words ("" when it failed or was silent)
 * and returns the phrases that can now be added, in order.
 */
export class ClipQueue {
  private next = 1;
  private done = new Map<number, string>();

  settle(seq: number, text: string): string[] {
    if (seq < this.next || this.done.has(seq)) return [];
    this.done.set(seq, text);
    const ready: string[] = [];
    while (this.done.has(this.next)) {
      const value = this.done.get(this.next) ?? "";
      this.done.delete(this.next);
      this.next += 1;
      if (value) ready.push(value);
    }
    return ready;
  }

  get waiting(): number {
    return this.done.size;
  }
}
