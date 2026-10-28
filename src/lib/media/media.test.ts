import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { drawtextFont, isUploadedKey, narrationScript } = await import("./render");
const { ffmpegAsset } = await import("./tools");

describe("media", () => {
  it("escapes a Windows font path for drawtext", () => {
    expect(drawtextFont("C:\\Windows\\Fonts\\arialbd.ttf")).toBe("'C\\:/Windows/Fonts/arialbd.ttf'");
    expect(drawtextFont("/usr/share/fonts/DejaVu Sans.ttf")).toBe("'/usr/share/fonts/DejaVu Sans.ttf'");
  });

  it("has a one-click ffmpeg for Windows x64", () => {
    const asset = ffmpegAsset("win32", "x64");
    expect(asset?.url).toMatch(/^https:\/\/github\.com\/eugeneware\/ffmpeg-static\/releases\/download\/b6\.1\.1\/ffmpeg-win32-x64\.gz$/);
    expect(ffmpegAsset("win32", "ia32")).toBeNull();
  });

  it("narrates the whole book: preface, chapters, narrative and visible quotes", () => {
    const script = narrationScript({
      title: "Book",
      question: "Smarter or lazier?",
      preface: "Two people answered",
      chapters: [
        {
          title: "One",
          narrative: "People check drafts",
          quotes: [
            { englishText: "I check the answer.", speakerName: "Asha", hidden: false },
            { englishText: "Secret line", speakerName: "Ravi", hidden: true },
          ],
        },
        { title: "Two", narrative: "Others skip them.", quotes: [] },
      ],
    } as never);
    expect(script).toBe(
      "Book. Smarter or lazier? Two people answered. Chapter One. One. People check drafts. Asha said: I check the answer. Chapter Two. Two. Others skip them.",
    );
    expect(script).not.toContain("Secret");
  });

  it("only treats the creator's own uploads as uploaded", () => {
    expect(isUploadedKey("book-abc-audiobook-upload.mp3")).toBe(true);
    expect(isUploadedKey("book-abc-audiobook.mp3")).toBe(false);
    expect(isUploadedKey(null)).toBe(false);
  });
});
