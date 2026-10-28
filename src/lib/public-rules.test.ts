import { describe, expect, it } from "vitest";
import { adminAllowed, canLeadHome, isReleased, parseAdmins } from "./public-rules";
import { publicOrigin } from "./http";

describe("what the public site may show", () => {
  it("lets released books and open books lead the home page", () => {
    expect(canLeadHome({ status: "PUBLISHED", type: "INVITED", publishedDraftId: "d1" })).toBe(true);
    expect(canLeadHome({ status: "COLLECTING", type: "OPEN", publishedDraftId: null })).toBe(true);
    expect(canLeadHome({ status: "REVIEW", type: "FAMOUS", publishedDraftId: null })).toBe(true);
  });
  it("never puts invited or solo books on the home page before release", () => {
    expect(canLeadHome({ status: "COLLECTING", type: "INVITED", publishedDraftId: null })).toBe(false);
    expect(canLeadHome({ status: "REVIEW", type: "SOLO", publishedDraftId: null })).toBe(false);
  });
  it("needs a published version before a book counts as released", () => {
    expect(isReleased({ status: "PUBLISHED", publishedDraftId: null })).toBe(false);
    expect(canLeadHome({ status: "PUBLISHED", type: "OPEN", publishedDraftId: null })).toBe(false);
    expect(isReleased({ status: "REVIEW", publishedDraftId: "d1" })).toBe(false);
    expect(isReleased({ status: "PUBLISHED", publishedDraftId: "d1" })).toBe(true);
  });
});

describe("home page admins", () => {
  it("parses a comma list, case-insensitive", () => {
    expect(parseAdmins(" A@x.com, b@Y.com ,")).toEqual(["a@x.com", "b@y.com"]);
    expect(adminAllowed("B@y.com", ["a@x.com", "b@y.com"], true)).toBe(true);
    expect(adminAllowed("c@z.com", ["a@x.com"], false)).toBe(false);
  });
  it("with no list: anyone in development, nobody in production", () => {
    expect(adminAllowed("c@z.com", [], false)).toBe(true);
    expect(adminAllowed("c@z.com", [], true)).toBe(false);
    expect(adminAllowed(null, [], false)).toBe(false);
  });
});

describe("public origin for links", () => {
  it("uses APP_URL in production and the request elsewhere", () => {
    const request = new Request("http://0.0.0.0:3000/api/auth/magic");
    const env = process.env as Record<string, string | undefined>;
    const before = { node: env.NODE_ENV, app: env.APP_URL };
    try {
      env.APP_URL = "https://books.example.com/";
      env.NODE_ENV = "production";
      expect(publicOrigin(request)).toBe("https://books.example.com");
      env.NODE_ENV = "test";
      expect(publicOrigin(request)).toBe("http://0.0.0.0:3000");
    } finally {
      env.NODE_ENV = before.node;
      env.APP_URL = before.app;
    }
  });
});
