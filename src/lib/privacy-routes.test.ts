/**
 * End-to-end privacy checks against a real (temporary) database and the real route handlers:
 * another user, the site admin and signed-out visitors get nothing of an unreleased book; the owner does.
 */
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ user: null as null | { id: string; email: string; name: string | null }, cookies: new Map<string, string>() }));
const dir = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { mkdtempSync } = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tmpdir } = require("node:os") as typeof import("node:os");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  const made = mkdtempSync(path.join(tmpdir(), "bbtp-privacy-"));
  process.env.DATABASE_URL = `file:${path.join(made, "test.db")}`;
  process.env.SITE_ADMIN_EMAILS = "admin@example.com";
  return made;
});

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.cookies.has(name) ? { name, value: state.cookies.get(name)! } : undefined),
    set: (name: string, value: string) => void state.cookies.set(name, value),
  }),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/auth", () => ({
  getCurrentUser: async () => state.user,
  requireApiUser: async () => {
    if (!state.user) {
      const { AppError } = await import("@/lib/errors");
      throw new AppError("Sign in first.", 401);
    }
    return state.user;
  },
}));
const deleted: string[] = [];
vi.mock("@/lib/storage", () => ({
  getAudio: async () => Buffer.from("RIFF-audio"),
  publicAudioUrl: async () => null,
  putAudio: async () => undefined,
  deleteAudio: async (key: string) => void deleted.push(key),
}));

type Prisma = typeof import("@/lib/db")["prisma"];
let prisma: Prisma;
const owner = { id: "", email: "owner@example.com", name: "Owner" };
const other = { id: "", email: "other@example.com", name: "Other" };
const admin = { id: "", email: "admin@example.com", name: "Admin" };
let sealedVoice = "";
let otherVoice = "";

const req = (url: string, init?: RequestInit) =>
  new Request(`http://localhost${url}`, { ...init, headers: { origin: "http://localhost", host: "localhost", ...(init?.headers ?? {}) } });
const as = (who: typeof owner | null) => {
  state.user = who;
  state.cookies.clear();
};

beforeAll(async () => {
  execSync("npx prisma db push --skip-generate --schema prisma/schema.prisma", {
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: "ignore",
  });
  ({ prisma } = await import("@/lib/db"));
  for (const person of [owner, other, admin]) {
    person.id = (await prisma.user.create({ data: { email: person.email, name: person.name } })).id;
  }
  const book = await prisma.book.create({
    data: {
      slug: "secret-book",
      title: "Secret book",
      question: "What should stay private?",
      type: "OPEN",
      creatorId: owner.id,
      inviteToken: "inv_secret",
      audiobookKey: "bbtp/x/audiobook.wav",
    },
  });
  const voice = (data: Record<string, unknown>) =>
    prisma.voice.create({
      data: { bookId: book.id, contributorName: "Asha", language: "en", consentAt: new Date(), status: "READY", storageKey: `bbtp/x/${Math.random()}.wav`, originalText: "my private words", ...data },
    });
  sealedVoice = (await voice({ guestKey: "" })).id;
  otherVoice = (await voice({ userId: "placeholder" })).id;
  await prisma.voice.update({ where: { id: otherVoice }, data: { userId: other.id } });
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("recordings of an unreleased book", () => {
  it("are 404 for a signed-out visitor, another user and the admin", async () => {
    const { GET } = await import("@/app/api/audio/[voiceId]/route");
    for (const who of [null, other, admin]) {
      as(who);
      const response = await GET(req(`/api/audio/${sealedVoice}`), { params: Promise.resolve({ voiceId: sealedVoice }) });
      expect(response.status, who?.email ?? "signed out").toBe(404);
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
  });
  it("play for the owner, never publicly cached", async () => {
    const { GET } = await import("@/app/api/audio/[voiceId]/route");
    as(owner);
    const response = await GET(req(`/api/audio/${sealedVoice}`), { params: Promise.resolve({ voiceId: sealedVoice }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("play for the person who recorded them", async () => {
    const { GET } = await import("@/app/api/audio/[voiceId]/route");
    as(other);
    const response = await GET(req(`/api/audio/${otherVoice}`), { params: Promise.resolve({ voiceId: otherVoice }) });
    expect(response.status).toBe(200);
  });
});

describe("audiobook and video files of an unreleased book", () => {
  it("are 404 for everyone but the owner", async () => {
    const { GET } = await import("@/app/api/media/[slug]/[kind]/route");
    for (const who of [null, other, admin]) {
      as(who);
      const response = await GET(req("/api/media/secret-book/audiobook"), { params: Promise.resolve({ slug: "secret-book", kind: "audiobook" }) });
      expect(response.status, who?.email ?? "signed out").toBe(404);
    }
    as(owner);
    const mine = await GET(req("/api/media/secret-book/audiobook"), { params: Promise.resolve({ slug: "secret-book", kind: "audiobook" }) });
    expect(mine.status).toBe(200);
    expect(mine.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("listings", () => {
  it("never list unlisted or unreleased books in the Library, and page /books", async () => {
    const { browseOpenBooks, browseLibrary } = await import("@/lib/public-books");
    for (let index = 0; index < 15; index += 1) {
      await prisma.book.create({
        data: {
          slug: `open-${index}`,
          title: `Open ${index}`,
          question: index % 2 ? "Tell me about rain" : "Tell me about home",
          type: "OPEN",
          creatorId: other.id,
          inviteToken: `inv_${index}`,
          language: index < 5 ? "hi" : "en",
          unlisted: index === 14,
        },
      });
    }
    const first = await browseOpenBooks({ page: 1, size: 12 });
    expect(first.total).toBe(15); // 14 listed + the secret book, which is open but not unlisted
    expect(first.books).toHaveLength(12);
    expect(first.hasNext).toBe(true);
    const second = await browseOpenBooks({ page: 2, size: 12 });
    expect(second.books).toHaveLength(3);
    expect(first.books.concat(second.books).some((book) => book.slug === "open-14")).toBe(false);
    expect((await browseOpenBooks({ q: "RAIN" })).total).toBe(7);
    expect((await browseOpenBooks({ lang: "hi" })).total).toBe(5);
    expect((await browseLibrary({})).total).toBe(0);
  });
});

describe("owner names on public cards", () => {
  it("never show an email or the default name made from it", async () => {
    const { ownerName } = await import("@/lib/public-books");
    expect(ownerName({ name: "Meera Iyer", email: "meera@example.com" })).toBe("Meera Iyer");
    expect(ownerName({ name: "meera.iyer", email: "meera.iyer@example.com" })).toBe("A reader");
    expect(ownerName({ name: "x@y.com", email: "z@example.com" })).toBe("A reader");
    expect(ownerName({ name: null, email: "z@example.com" })).toBe("A reader");
  });
});

describe("deleting", () => {
  it("a voice: not by another user or the admin; yes by its contributor", async () => {
    const { DELETE } = await import("@/app/api/voices/[id]/route");
    for (const who of [null, admin]) {
      as(who);
      const response = await DELETE(req(`/api/voices/${otherVoice}`, { method: "DELETE" }), { params: Promise.resolve({ id: otherVoice }) });
      expect(response.status, who?.email ?? "signed out").toBe(404);
    }
    as(other);
    const response = await DELETE(req(`/api/voices/${otherVoice}`, { method: "DELETE" }), { params: Promise.resolve({ id: otherVoice }) });
    expect(response.status).toBe(200);
    expect(await prisma.voice.findUnique({ where: { id: otherVoice } })).toBeNull();
  });
  it("a book: never by another user; yes by the admin (abuse) without returning content", async () => {
    const { DELETE } = await import("@/app/api/books/[id]/route");
    const book = await prisma.book.findUniqueOrThrow({ where: { slug: "secret-book" } });
    as(other);
    const denied = await DELETE(req(`/api/books/${book.id}`, { method: "DELETE" }), { params: Promise.resolve({ id: book.id }) });
    expect(denied.status).toBe(404);
    as(admin);
    const done = await DELETE(req(`/api/books/${book.id}`, { method: "DELETE" }), { params: Promise.resolve({ id: book.id }) });
    expect(done.status).toBe(200);
    expect(JSON.stringify(await done.json())).not.toContain("private");
    expect(await prisma.book.findUnique({ where: { id: book.id } })).toBeNull();
    expect(deleted).toContain("bbtp/x/audiobook.wav");
  });
});
