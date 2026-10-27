export type VoiceGateInput = {
  bookType: string;
  status: string;
  closesAt: number | null;
  creatorId: string;
  inviteToken: string;
  viewerId: string | null;
  providedInvite: string | null;
  now?: number;
  paused: boolean;
};

export function canAcceptVoice(input: VoiceGateInput): { ok: true } | { ok: false; reason: string } {
  const now = input.now ?? Date.now();
  if (input.paused) return { ok: false, reason: "Voices are paused right now" };
  if (input.bookType === "FAMOUS") {
    return { ok: false, reason: "This book uses public sourced quotes, not recordings." };
  }
  if (input.status === "PUBLISHED") return { ok: false, reason: "This book is already published." };
  if (input.status === "GENERATING" || input.status === "REVIEW" || input.status === "CLOSED") {
    return { ok: false, reason: "Voices are closed. The book is being written." };
  }
  if (input.closesAt !== null && input.closesAt <= now) {
    return { ok: false, reason: "Voices are closed." };
  }
  if (input.bookType === "SOLO" && input.viewerId !== input.creatorId) {
    return { ok: false, reason: "Only the author records this book." };
  }
  if (
    input.bookType === "INVITED" &&
    input.viewerId !== input.creatorId &&
    input.providedInvite !== input.inviteToken
  ) {
    return { ok: false, reason: "This book is invite-only." };
  }
  return { ok: true };
}

export function canGenerate(input: {
  bookType: string;
  status: string;
  readyCount: number;
  paused: boolean;
  live: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (input.readyCount < 1) return { ok: false, reason: "Add at least one voice or sourced quote first." };
  if (input.paused && input.live) {
    return { ok: false, reason: "Voice processing is paused because the spend cap was reached." };
  }
  if (input.status === "GENERATING") return { ok: false, reason: "A draft is already being written." };
  const openEnded = input.bookType === "SOLO" || input.bookType === "FAMOUS" || input.status === "PUBLISHED";
  if (!openEnded && input.status !== "CLOSED" && input.status !== "REVIEW") {
    return { ok: false, reason: "Close voices before making the book." };
  }
  if (input.status === "DRAFT") return { ok: false, reason: "This book is not open yet." };
  return { ok: true };
}

export function statusAfterGenerationFailure(previous: string): string {
  if (previous === "GENERATING") return "REVIEW";
  return previous;
}

export function selectRollback(
  versions: { id: string; version: number }[],
  targetId: string,
  currentId: string | null,
): { nextCurrentId: string; versions: { id: string; version: number }[] } | { error: string } {
  const target = versions.find((version) => version.id === targetId);
  if (!target) return { error: "That version does not exist." };
  if (target.id === currentId) return { error: "That version is already current." };
  return { nextCurrentId: target.id, versions };
}

export function validateSourcedQuote(input: {
  speaker: string;
  text: string;
  sourceUrl: string;
}): { ok: true } | { ok: false; error: string } {
  if (!input.speaker.trim()) return { ok: false, error: "Name the person who said it." };
  if (input.text.trim().length < 12) return { ok: false, error: "Paste the quotation itself." };
  let url: URL;
  try {
    url = new URL(input.sourceUrl.trim());
  } catch {
    return { ok: false, error: "Add the public source link." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "The source link has to be a public http or https URL." };
  }
  return { ok: true };
}

export function slugify(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "book";
}
