const hits = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

/** Per-hour budget for a public form: strict in production, loose in dev and tests. */
export function hourly(key: string, productionLimit: number): boolean {
  return rateLimit(key, process.env.NODE_ENV === "production" ? productionLimit : 10_000, 60 * 60 * 1000);
}
