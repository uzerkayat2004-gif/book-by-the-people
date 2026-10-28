import { afterEach, describe, expect, it, vi } from "vitest";
import { chapterSummary, clip } from "./summary";

describe("chapter summary", () => {
  it("never repeats the chapter title", () => {
    expect(chapterSummary("The Draft Effect", "The draft effect", "People check drafts. Then they edit.")).toBe("People check drafts.");
    expect(chapterSummary("One", "", "One.")).toBe("");
    expect(chapterSummary("One", "Checking the answer", "")).toBe("Checking the answer");
  });

  it("cuts long text at a word", () => {
    expect(clip("short", 20)).toBe("short");
    const cut = clip("the quick brown fox jumps over the lazy dog", 20);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(21);
  });
});

describe("storage driver", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses Vercel Blob when its token is set, local files otherwise", async () => {
    const { getConfig } = await import("../config");
    vi.stubEnv("STORAGE_DRIVER", "");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    expect(getConfig().storageDriver).toBe("local");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test");
    expect(getConfig().storageDriver).toBe("blob");
    vi.stubEnv("STORAGE_DRIVER", "local");
    expect(getConfig().storageDriver).toBe("local");
  });
});
