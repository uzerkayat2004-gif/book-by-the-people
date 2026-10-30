/**
 * How long a written answer may be. The book's old time limit (seconds of talking) maps to
 * ~150 words a minute at ~6 characters a word, capped at the server's 9,000 characters.
 */
export const MAX_ANSWER_CHARS = 9000;

export function answerLimits(maxSeconds = 600) {
  const maxChars = Math.min(MAX_ANSWER_CHARS, Math.max(600, Math.round((maxSeconds / 60) * 150 * 6)));
  const maxWords = Math.round(maxChars / 6 / 50) * 50 || 100;
  return { maxChars, maxWords };
}
