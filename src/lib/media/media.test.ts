import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { drawtextFont, narrationScript } = await import("./render");
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

  it("narrates the title, question, chapters and visible quotes only", () => {
    const script = narrationScript({
      title: "Book",
      question: "Smarter or lazier?",
      chapters: [
        {
          title: "One",
          quotes: [
            { englishText: "I check the answer.", hidden: false },
            { englishText: "Secret line", hidden: true },
          ],
        },
      ],
    } as never);
    expect(script).toBe("Book. Smarter or lazier? One. I check the answer.");
    expect(script).not.toContain("Secret");
  });
});
