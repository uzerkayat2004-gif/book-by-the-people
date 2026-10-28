import { describe, expect, it } from "vitest";
import {
  canDeleteVoice,
  canGetMedia,
  canHearVoice,
  canManageBook,
  canReadBook,
  canSeeOwnVoice,
  cleanSearch,
  pageOf,
  readableDraftId,
} from "./privacy";

const owner = { id: "u_owner" };
const other = { id: "u_other" };
const admin = { id: "u_admin" }; // The site admin is just another user here: no rule takes an admin flag.
const signedOut = null;

const open = { creatorId: owner.id, status: "COLLECTING", publishedDraftId: null, currentDraftId: "d_draft" };
const review = { creatorId: owner.id, status: "REVIEW", publishedDraftId: null, currentDraftId: "d_draft" };
const released = { creatorId: owner.id, status: "PUBLISHED", publishedDraftId: "d_pub", currentDraftId: "d_next" };

const voiceByOther = { userId: other.id, guestKey: "", hidden: false, status: "READY" };
const guestVoice = { userId: "", guestKey: "g_hash", hidden: false, status: "READY" };

describe("an unreleased book is the owner's alone", () => {
  for (const book of [open, review]) {
    it(`${book.status}: owner can read, manage, preview and get media`, () => {
      expect(canReadBook(book, owner)).toBe(true);
      expect(canManageBook(book, owner)).toBe(true);
      expect(canGetMedia(book, owner)).toBe(true);
      expect(readableDraftId(book, owner, true)).toBe("d_draft");
    });
    for (const [who, viewer] of [
      ["another user", other],
      ["the admin", admin],
      ["a signed-out visitor", signedOut],
    ] as const) {
      it(`${book.status}: ${who} is denied`, () => {
        expect(canReadBook(book, viewer)).toBe(false);
        expect(canManageBook(book, viewer)).toBe(false);
        expect(canGetMedia(book, viewer)).toBe(false);
        expect(readableDraftId(book, viewer, true)).toBeNull();
        expect(readableDraftId(book, viewer, false)).toBeNull();
        expect(canHearVoice({ voice: guestVoice, book, viewer, guestKey: null, usedInRelease: false })).toBe(false);
      });
    }
  }
});

describe("after release", () => {
  it("everyone reads the published version, only the owner previews the next one", () => {
    expect(readableDraftId(released, other, true)).toBe("d_pub");
    expect(readableDraftId(released, signedOut, false)).toBe("d_pub");
    expect(readableDraftId(released, owner, true)).toBe("d_next");
    expect(canReadBook(released, signedOut)).toBe(true);
    expect(canGetMedia(released, admin)).toBe(true);
  });
  it("settings and the studio stay owner-only", () => {
    expect(canManageBook(released, admin)).toBe(false);
    expect(canManageBook(released, other)).toBe(false);
  });
  it("a recording is public only if the published book quotes it", () => {
    expect(canHearVoice({ voice: guestVoice, book: released, viewer: signedOut, guestKey: null, usedInRelease: true })).toBe(true);
    expect(canHearVoice({ voice: guestVoice, book: released, viewer: signedOut, guestKey: null, usedInRelease: false })).toBe(false);
    expect(canHearVoice({ voice: { ...guestVoice, hidden: true }, book: released, viewer: signedOut, guestKey: null, usedInRelease: true })).toBe(false);
  });
});

describe("contributors", () => {
  it("see, hear and delete only their own voice", () => {
    expect(canSeeOwnVoice(voiceByOther, open, other, null)).toBe(true);
    expect(canDeleteVoice(voiceByOther, open, other, null)).toBe(true);
    expect(canHearVoice({ voice: voiceByOther, book: open, viewer: other, guestKey: null, usedInRelease: false })).toBe(true);
    expect(canSeeOwnVoice(voiceByOther, open, admin, null)).toBe(false);
    expect(canDeleteVoice(voiceByOther, open, admin, null)).toBe(false);
    expect(canDeleteVoice(voiceByOther, open, signedOut, null)).toBe(false);
  });
  it("guests prove it with their private browser key", () => {
    expect(canDeleteVoice(guestVoice, open, signedOut, "g_hash")).toBe(true);
    expect(canDeleteVoice(guestVoice, open, signedOut, "g_other")).toBe(false);
    expect(canDeleteVoice(guestVoice, open, signedOut, null)).toBe(false);
    // An empty key never matches an empty stored key.
    expect(canDeleteVoice({ ...guestVoice, guestKey: "" }, open, signedOut, "")).toBe(false);
  });
  it("the owner may remove any voice from their own book", () => {
    expect(canDeleteVoice(voiceByOther, open, owner, null)).toBe(true);
  });
});

describe("pages", () => {
  it("splits, clamps and reports neighbours", () => {
    expect(pageOf({ page: 1, total: 100, size: 12 })).toMatchObject({ page: 1, pages: 9, skip: 0, take: 12, hasPrev: false, hasNext: true });
    expect(pageOf({ page: "3", total: 100, size: 12 })).toMatchObject({ page: 3, skip: 24, hasPrev: true, hasNext: true });
    expect(pageOf({ page: 99, total: 100, size: 12 })).toMatchObject({ page: 9, skip: 96, hasNext: false });
    expect(pageOf({ page: "-2", total: 100, size: 12 }).page).toBe(1);
    expect(pageOf({ page: "abc", total: 100, size: 12 }).page).toBe(1);
    expect(pageOf({ page: 4, total: 0, size: 12 })).toMatchObject({ page: 1, pages: 1, skip: 0, hasNext: false });
    expect(pageOf({ page: 2, total: 24, size: 12 })).toMatchObject({ page: 2, pages: 2, hasNext: false });
  });
  it("cleans search text", () => {
    expect(cleanSearch("  climate   change ")).toBe("climate change");
    expect(cleanSearch(["x"])).toBe("");
    expect(cleanSearch("a".repeat(200))).toHaveLength(80);
  });
});
