/**
 * Puts the Meta video book together in the creator's browser: pictures, quote cards and captions drawn on a
 * canvas, the narration copied in as it is, encoded to MP4 with WebCodecs (via mediabunny), then uploaded in parts.
 * Browser only.
 */
import {
  ALL_FORMATS,
  AudioBufferSource,
  BufferSource as MediaBufferSource,
  BufferTarget,
  CanvasSource,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  Input,
  Mp4OutputFormat,
  Output,
  canEncodeAudio,
  getFirstEncodableVideoCodec,
} from "mediabunny";

export type PlanScene = {
  startMs: number;
  endMs: number;
  kind: "opening" | "picture" | "quote" | "card" | "end";
  image?: string;
  title?: string;
  subtitle?: string;
  quote?: { text: string; speaker: string; country: string | null };
  chapter?: string;
  unit?: number;
  credits?: string[];
};

export type Overlay = { startMs: number; endMs: number; kind: "quote" | "count"; text: string; who?: string; sub?: string };

export type FilmPlan = {
  hash: string;
  width: number;
  height: number;
  fps: number;
  audio: { src: string; ms: number };
  totalMs: number;
  title: string;
  question: string;
  lang: string;
  scenes: PlanScene[];
  captions: { startMs: number; endMs: number; text: string }[];
  overlays?: Overlay[];
  style?: "documentary";
  credit: string;
  uploadId: string;
  chunkBytes: number;
};

export type FilmProgress = { stage: "load" | "encode" | "upload"; percent: number; note: string };

const RED = "#c92e34";
const FADE_MS = 500;
/** Documentary films: slow crossfades between long scenes. */
const DOC_FADE_MS = 900;
const CHAPTER_MS = 3500;
const CHAPTER_DOC_MS = 5000;

function cssFont(name: string, fallback: string) {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value ? `${value}, ${fallback}` : fallback;
}

type Fonts = { display: string; serif: string; sans: string };

function countryName(code: string | null, lang: string) {
  if (!code) return "";
  try {
    return new Intl.DisplayNames([lang, "en"], { type: "region" }).of(code.toUpperCase()) ?? "";
  } catch {
    return "";
  }
}

function wrap(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function backdrop(ctx: Ctx, w: number, h: number, t: number) {
  ctx.fillStyle = "#0e0c0c";
  ctx.fillRect(0, 0, w, h);
  const x = w * (0.3 + 0.05 * Math.sin(t / 4000));
  const g = ctx.createRadialGradient(x, h * 0.35, 20, x, h * 0.35, w * 0.75);
  g.addColorStop(0, "rgba(201,46,52,0.42)");
  g.addColorStop(0.55, "rgba(90,20,24,0.18)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function fitText(ctx: Ctx, text: string, font: (size: number) => string, maxWidth: number, maxLines: number, start: number, min: number) {
  let size = start;
  let lines: string[] = [];
  for (; size >= min; size -= 2) {
    ctx.font = font(size);
    lines = wrap(ctx, text, maxWidth);
    if (lines.length <= maxLines) break;
  }
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[\s,.;:]+\S*$/, "")}…`;
  }
  return { size, lines };
}

function drawCard(ctx: Ctx, w: number, h: number, scene: PlanScene, local: number, fonts: Fonts, credit: string) {
  backdrop(ctx, w, h, local);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const title = scene.title ?? "";
  const big = fitText(ctx, title, (s) => `600 ${s}px ${fonts.display}`, w * 0.8, 3, scene.kind === "opening" || scene.kind === "end" ? 72 : 60, 30);
  const lineH = big.size * 1.15;
  const sub = scene.subtitle ? fitText(ctx, scene.subtitle, (s) => `italic ${s}px ${fonts.serif}`, w * 0.72, 3, 32, 20) : null;
  const subH = sub ? sub.lines.length * sub.size * 1.35 + 34 : 0;
  let y = h / 2 - (big.lines.length * lineH + subH) / 2 + big.size;
  ctx.fillStyle = RED;
  ctx.fillRect(w / 2 - 36, y - big.size - 34, 72, 4);
  ctx.fillStyle = "#f6efe6";
  ctx.font = `600 ${big.size}px ${fonts.display}`;
  for (const line of big.lines) {
    ctx.fillText(line, w / 2, y);
    y += lineH;
  }
  if (sub) {
    y += 18;
    ctx.fillStyle = "rgba(246,239,230,0.78)";
    ctx.font = `italic ${sub.size}px ${fonts.serif}`;
    for (const line of sub.lines) {
      ctx.fillText(line, w / 2, y);
      y += sub.size * 1.35;
    }
  }
  if (scene.kind === "end") {
    ctx.fillStyle = "rgba(246,239,230,0.85)";
    ctx.font = `500 26px ${fonts.sans}`;
    ctx.fillText("Made from the voices of real people", w / 2, h - 120);
    ctx.fillStyle = "rgba(246,239,230,0.55)";
    const small = fitText(ctx, credit, (s) => `${s}px ${fonts.sans}`, w * 0.85, 2, 18, 14);
    small.lines.forEach((line, i) => ctx.fillText(line, w / 2, h - 80 + i * 24));
    ctx.fillStyle = RED;
    ctx.font = `700 20px ${fonts.sans}`;
    ctx.fillText("BOOK BY THE PEOPLE", w / 2, h - 30);
  }
}

function drawPicture(ctx: Ctx, w: number, h: number, image: ImageBitmap, local: number, duration: number, index: number, documentary = false) {
  const p = Math.min(1, Math.max(0, local / Math.max(1, duration)));
  // Ken Burns: a slow push in or pull out with a gentle pan; slower and smoother on long documentary scenes.
  const ease = documentary ? p * p * (3 - 2 * p) * 0.35 + p * 0.65 : p;
  const scale = documentary ? 1.05 + 0.09 * (index % 2 ? 1 - ease : ease) : 1.04 + 0.08 * (index % 2 ? 1 - p : p);
  const cover = Math.max(w / image.width, h / image.height) * scale;
  const dw = image.width * cover;
  const dh = image.height * cover;
  const dir = index % 3 === 0 ? 1 : index % 3 === 1 ? -1 : 0;
  const x = (w - dw) / 2 + dir * (dw - w) * 0.35 * (ease - 0.5);
  const y = (h - dh) / 2 + (index % 2 ? 1 : -1) * (dh - h) * 0.25 * (ease - 0.5);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  if (documentary) {
    // One grade for every picture: a little less colour, a little more contrast, a warm tint.
    ctx.filter = "saturate(0.88) contrast(1.05) sepia(0.1) brightness(0.97)";
    ctx.drawImage(image, x, y, dw, dh);
    ctx.filter = "none";
    ctx.fillStyle = "rgba(60,30,10,0.07)";
    ctx.fillRect(0, 0, w, h);
    const vignette = ctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, w * 0.72);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.42)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
  } else ctx.drawImage(image, x, y, dw, dh);
  const shade = ctx.createLinearGradient(0, h * 0.55, 0, h);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, w, h);
}

/** A quote over the picture, lower left, while the narrator reads it. */
function drawLowerThird(ctx: Ctx, w: number, h: number, overlay: Overlay, t: number, fonts: Fonts) {
  const alpha = Math.max(0, Math.min(1, (t - overlay.startMs) / 450, (overlay.endMs - t) / 450));
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const rise = (1 - Math.min(1, (t - overlay.startMs) / 450)) * 14;
  const maxW = w * 0.62;
  const body = fitText(ctx, `\u201C${overlay.text.replace(/^["\u201C]+|["\u201D]+$/g, "")}\u201D`, (s) => `italic ${s}px ${fonts.serif}`, maxW, 4, 31, 21);
  const lineH = body.size * 1.32;
  const who = [overlay.who, overlay.sub].filter(Boolean).join(", ");
  const boxH = body.lines.length * lineH + (who ? 44 : 14) + 26;
  const x = 64;
  const y = h - 64 - boxH + rise;
  ctx.font = `italic ${body.size}px ${fonts.serif}`;
  const textW = Math.max(...body.lines.map((l) => ctx.measureText(l).width));
  const g = ctx.createLinearGradient(x, 0, x + textW + 120, 0);
  g.addColorStop(0, "rgba(12,10,10,0.84)");
  g.addColorStop(0.8, "rgba(12,10,10,0.72)");
  g.addColorStop(1, "rgba(12,10,10,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, textW + 120, boxH);
  ctx.fillStyle = RED;
  ctx.fillRect(x, y, 5, boxH);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#f6efe6";
  body.lines.forEach((line, i) => ctx.fillText(line, x + 30, y + 22 + body.size + i * lineH));
  if (who) {
    ctx.fillStyle = "rgba(246,239,230,0.78)";
    ctx.font = `600 21px ${fonts.sans}`;
    ctx.fillText(`\u2014 ${who}`, x + 30, y + boxH - 22, maxW);
  }
  ctx.restore();
}

/** "46 voices": how many people shared the view being told, top right. */
function drawCount(ctx: Ctx, w: number, overlay: Overlay, t: number, fonts: Fonts) {
  const alpha = Math.max(0, Math.min(1, (t - overlay.startMs) / 500, (overlay.endMs - t) / 600));
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `600 46px ${fonts.display}`;
  const numW = ctx.measureText(overlay.text).width;
  ctx.font = `600 17px ${fonts.sans}`;
  const label = (overlay.sub ?? "voices").slice(0, 46);
  const top = overlay.sub && overlay.sub.startsWith("voices") ? overlay.sub : "voices";
  const bottom = top === overlay.sub ? "" : label;
  const textW = Math.max(ctx.measureText(top.toUpperCase()).width, bottom ? ctx.measureText(bottom).width : 0);
  const boxW = numW + textW + 64;
  const x = w - 56 - boxW;
  const y = 48;
  ctx.fillStyle = "rgba(12,10,10,0.74)";
  ctx.fillRect(x, y, boxW, 74);
  ctx.fillStyle = RED;
  ctx.fillRect(x, y + 70, boxW, 4);
  ctx.textAlign = "left";
  ctx.fillStyle = "#f6efe6";
  ctx.font = `600 46px ${fonts.display}`;
  ctx.fillText(overlay.text, x + 22, y + 54);
  ctx.font = `700 15px ${fonts.sans}`;
  ctx.fillStyle = "rgba(246,239,230,0.9)";
  ctx.fillText(top.toUpperCase(), x + 40 + numW, y + (bottom ? 32 : 44));
  if (bottom) {
    ctx.font = `italic 17px ${fonts.serif}`;
    ctx.fillStyle = "rgba(246,239,230,0.72)";
    ctx.fillText(bottom, x + 40 + numW, y + 54);
  }
  ctx.restore();
}

function drawCredits(ctx: Ctx, w: number, h: number, scene: PlanScene, local: number, fonts: Fonts, credit: string) {
  backdrop(ctx, w, h, local);
  const rise = Math.min(1, local / 1200);
  ctx.globalAlpha = rise;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const title = fitText(ctx, scene.title ?? "", (s) => `600 ${s}px ${fonts.display}`, w * 0.8, 2, 60, 30);
  let y = h * 0.3 + (1 - rise) * 10;
  ctx.fillStyle = RED;
  ctx.fillRect(w / 2 - 36, y - title.size - 30, 72, 4);
  ctx.fillStyle = "#f6efe6";
  ctx.font = `600 ${title.size}px ${fonts.display}`;
  for (const line of title.lines) {
    ctx.fillText(line, w / 2, y);
    y += title.size * 1.15;
  }
  y += 26;
  for (const [i, line] of (scene.credits ?? []).entries()) {
    const fit = fitText(ctx, line, (s) => `${i === 0 ? "500 " : "italic "}${s}px ${i === 0 ? fonts.sans : fonts.serif}`, w * 0.78, 2, i === 0 ? 27 : 23, 16);
    ctx.fillStyle = i === 0 ? "rgba(246,239,230,0.9)" : "rgba(246,239,230,0.72)";
    ctx.font = `${i === 0 ? "500 " : "italic "}${fit.size}px ${i === 0 ? fonts.sans : fonts.serif}`;
    for (const l of fit.lines) {
      ctx.fillText(l, w / 2, y);
      y += fit.size * 1.4;
    }
    y += 10;
  }
  ctx.fillStyle = "rgba(246,239,230,0.55)";
  const small = fitText(ctx, credit, (s) => `${s}px ${fonts.sans}`, w * 0.85, 2, 18, 14);
  small.lines.forEach((line, i) => ctx.fillText(line, w / 2, h - 84 + i * 24));
  ctx.fillStyle = RED;
  ctx.font = `700 20px ${fonts.sans}`;
  ctx.fillText("BOOK BY THE PEOPLE", w / 2, h - 34);
  ctx.globalAlpha = 1;
}

function drawQuote(ctx: Ctx, w: number, h: number, scene: PlanScene, local: number, fonts: Fonts, lang: string) {
  backdrop(ctx, w, h, local + 9000);
  const quote = scene.quote!;
  ctx.textAlign = "left";
  ctx.fillStyle = RED;
  ctx.font = `700 220px ${fonts.display}`;
  ctx.fillText("\u201C", 90, 250);
  const body = fitText(ctx, quote.text, (s) => `${s}px ${fonts.serif}`, w - 300, 7, 44, 22);
  const lineH = body.size * 1.4;
  let y = h / 2 - (body.lines.length * lineH) / 2 + body.size * 0.8;
  ctx.fillStyle = "#f6efe6";
  ctx.font = `${body.size}px ${fonts.serif}`;
  for (const line of body.lines) {
    ctx.fillText(line, 190, y);
    y += lineH;
  }
  const country = countryName(quote.country, lang);
  ctx.fillStyle = "rgba(246,239,230,0.75)";
  ctx.font = `600 24px ${fonts.sans}`;
  ctx.fillText(`\u2014 ${quote.speaker}${country ? `, ${country}` : ""}`, 190, Math.min(h - 50, y + 26));
}

function drawChapter(ctx: Ctx, w: number, h: number, title: string, local: number, fonts: Fonts, length = CHAPTER_MS) {
  const alpha = Math.min(1, local / 500, (length - local) / 600);
  if (alpha <= 0) return;
  ctx.globalAlpha = alpha;
  ctx.font = `600 34px ${fonts.display}`;
  const width = Math.min(w - 120, ctx.measureText(title).width + 64);
  ctx.fillStyle = "rgba(14,12,12,0.78)";
  ctx.fillRect(60, 52, width, 66);
  ctx.fillStyle = RED;
  ctx.fillRect(60, 52, 6, 66);
  ctx.fillStyle = "#f6efe6";
  ctx.textAlign = "left";
  ctx.fillText(title, 90, 97, width - 50);
  ctx.globalAlpha = 1;
}

function drawCaption(ctx: Ctx, w: number, h: number, text: string, fonts: Fonts) {
  ctx.font = `500 30px ${fonts.sans}`;
  const lines = wrap(ctx, text, w - 260).slice(0, 2);
  const boxW = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 48;
  const boxH = lines.length * 40 + 22;
  ctx.fillStyle = "rgba(0,0,0,0.62)";
  ctx.fillRect((w - boxW) / 2, h - 46 - boxH, boxW, boxH);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  lines.forEach((line, i) => ctx.fillText(line, w / 2, h - 46 - boxH + 42 + i * 40));
}

/** Draws the frame at time t (ms). Exported for tests and the preview. */
export function drawFrame(ctx: Ctx, plan: FilmPlan, images: Map<string, ImageBitmap>, t: number, fonts: Fonts) {
  const { width: w, height: h } = plan;
  const documentary = plan.style === "documentary";
  const fade = documentary ? DOC_FADE_MS : FADE_MS;
  const found = plan.scenes.findIndex((s) => t >= s.startMs && t < s.endMs);
  const index = found === -1 ? plan.scenes.length - 1 : found;
  const paint = (i: number) => {
    const scene = plan.scenes[i];
    const local = t - scene.startMs;
    const image = scene.image ? images.get(scene.image) : undefined;
    if (scene.kind === "picture" && image) drawPicture(ctx, w, h, image, local, scene.endMs - scene.startMs + fade, i, documentary);
    else if (scene.kind === "end" && scene.credits) drawCredits(ctx, w, h, scene, local, fonts, plan.credit);
    else {
      // Cards and quotes drift in slowly so they never sit still.
      const p = Math.min(1, Math.max(0, local / Math.max(1, scene.endMs - scene.startMs + fade)));
      const zoom = 1 + 0.035 * p;
      ctx.fillStyle = "#0e0c0c";
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-w / 2 + (i % 2 ? -1 : 1) * 10 * (p - 0.5), -h / 2);
      if (scene.kind === "quote" && scene.quote) drawQuote(ctx, w, h, scene, local, fonts, plan.lang);
      else drawCard(ctx, w, h, scene, local, fonts, plan.credit);
      ctx.restore();
    }
  };
  const scene = plan.scenes[index];
  const local = t - scene.startMs;
  if (index > 0 && local < fade) {
    // Crossfade: the scene before stays underneath while the new one comes up. Never a hard cut.
    paint(index - 1);
    ctx.globalAlpha = Math.max(0, local / fade);
    paint(index);
    ctx.globalAlpha = 1;
  } else paint(index);
  const chapterMs = documentary ? CHAPTER_DOC_MS : CHAPTER_MS;
  if (scene.chapter && local < chapterMs && !(scene.kind === "card" && scene.title === scene.chapter)) drawChapter(ctx, w, h, scene.chapter, local, fonts, chapterMs);
  const active = (plan.overlays ?? []).filter((o) => t >= o.startMs && t < o.endMs);
  const quote = active.find((o) => o.kind === "quote");
  if (scene.kind !== "end") {
    for (const overlay of active) {
      if (overlay.kind === "count") drawCount(ctx, w, overlay, t, fonts);
      else drawLowerThird(ctx, w, h, overlay, t, fonts);
    }
  }
  // Captions follow the narration, but step aside while a quote is on screen (the quote is the caption then).
  if (scene.kind !== "quote" && scene.kind !== "end" && !quote) {
    const caption = plan.captions.find((c) => t >= c.startMs && t < c.endMs);
    if (caption) drawCaption(ctx, w, h, caption.text, fonts);
  }
  if (documentary) {
    // Fade up from black at the start, down to black at the very end.
    const edge = Math.max(0, 1 - t / 1000, 1 - (plan.totalMs - t) / 1500);
    if (edge > 0) {
      ctx.fillStyle = `rgba(0,0,0,${Math.min(1, edge)})`;
      ctx.fillRect(0, 0, w, h);
    }
  }
}

async function fetchBytes(url: string, signal?: AbortSignal) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(url, { credentials: "same-origin", signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.arrayBuffer();
    } catch (error) {
      if (attempt >= 2 || signal?.aborted) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
}

/** Can this browser make the film? */
export function canMakeFilm() {
  return typeof window !== "undefined" && "VideoEncoder" in window && typeof OffscreenCanvas !== "undefined";
}

/** Renders the whole film. Returns the MP4 bytes. */
export async function renderFilm(plan: FilmPlan, onProgress: (p: FilmProgress) => void, signal?: AbortSignal): Promise<{ bytes: Uint8Array; codec: string }> {
  if (!canMakeFilm()) throw new Error("this browser cannot encode video");
  onProgress({ stage: "load", percent: 0, note: "Loading the narration and pictures" });
  if (typeof document !== "undefined" && document.fonts) await document.fonts.ready;
  const fonts: Fonts = { display: cssFont("--display", "Georgia, serif"), serif: cssFont("--serif", "Georgia, serif"), sans: cssFont("--sans", "system-ui, sans-serif") };
  const audioBytes = await fetchBytes(plan.audio.src, signal);
  const images = new Map<string, ImageBitmap>();
  const urls = Array.from(new Set(plan.scenes.map((s) => s.image).filter(Boolean) as string[]));
  let loaded = 0;
  for (const url of urls) {
    try {
      images.set(url, await createImageBitmap(new Blob([await fetchBytes(url, signal)])));
    } catch {
      // A picture that won't load becomes a styled card.
    }
    loaded += 1;
    onProgress({ stage: "load", percent: Math.round((loaded / Math.max(1, urls.length)) * 100), note: "Loading the pictures" });
  }

  const { width: w, height: h, fps } = plan;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  const format = new Mp4OutputFormat({ fastStart: "in-memory" });
  const output = new Output({ format, target: new BufferTarget() });
  const codec = await getFirstEncodableVideoCodec(["avc", "vp9", "av1"], { width: w, height: h });
  if (!codec) throw new Error("no video encoder is available");
  const video = new CanvasSource(canvas, { codec, bitrate: 1_400_000, keyFrameInterval: 4 });
  output.addVideoTrack(video, { frameRate: fps });

  // The narration: copied in as it is (MP3 in MP4), or re-encoded if the browser can't.
  const input = new Input({ source: new MediaBufferSource(audioBytes), formats: ALL_FORMATS });
  const track = await input.getPrimaryAudioTrack();
  if (!track) throw new Error("the narration could not be read");
  const passThrough = format.getSupportedCodecs().includes(track.codec as never) && track.codec === "mp3";
  let packetSource: EncodedAudioPacketSource | null = null;
  let bufferSource: AudioBufferSource | null = null;
  let decoded: AudioBuffer | null = null;
  if (passThrough) {
    packetSource = new EncodedAudioPacketSource("mp3");
    output.addAudioTrack(packetSource);
  } else {
    const audioCodec = (await canEncodeAudio("aac")) ? "aac" : "opus";
    bufferSource = new AudioBufferSource({ codec: audioCodec, bitrate: 64_000 });
    output.addAudioTrack(bufferSource);
    const context = new OfflineAudioContext(1, 1, 48_000);
    decoded = await context.decodeAudioData(audioBytes.slice(0));
  }
  await output.start();
  if (bufferSource && decoded) await bufferSource.add(decoded);

  const sink = passThrough ? new EncodedPacketSink(track) : null;
  const decoderConfig = passThrough ? await track.getDecoderConfig() : null;
  let packet = sink ? await sink.getFirstPacket() : null;
  let firstPacket = true;
  const pumpAudio = async (untilSec: number) => {
    while (packet && packetSource && packet.timestamp <= untilSec) {
      await packetSource.add(packet, firstPacket && decoderConfig ? { decoderConfig } : undefined);
      firstPacket = false;
      packet = await sink!.getNextPacket(packet);
    }
  };

  const frames = Math.ceil((plan.totalMs / 1000) * fps);
  let lastReport = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    if (signal?.aborted) {
      await output.cancel();
      throw new Error("stopped");
    }
    const t = (frame / fps) * 1000;
    drawFrame(ctx, plan, images, t, fonts);
    await pumpAudio(frame / fps + 1);
    await video.add(frame / fps, 1 / fps);
    if (frame - lastReport >= fps || frame === frames - 1) {
      lastReport = frame;
      onProgress({ stage: "encode", percent: Math.round(((frame + 1) / frames) * 100), note: `Putting the film together (${Math.round(t / 1000)} of ${Math.round(plan.totalMs / 1000)} seconds)` });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  await pumpAudio(Number.POSITIVE_INFINITY);
  await output.finalize();
  for (const image of images.values()) image.close();
  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) throw new Error("the film came out empty");
  return { bytes: new Uint8Array(buffer), codec: `${codec}+${passThrough ? "mp3" : "re-encoded audio"}` };
}

/** Uploads the film in parts, then asks the server to keep it. */
export async function uploadFilm(bookId: string, plan: FilmPlan, film: { bytes: Uint8Array; codec: string }, onProgress: (p: FilmProgress) => void) {
  const parts = Math.ceil(film.bytes.length / plan.chunkBytes);
  for (let part = 0; part < parts; part += 1) {
    const slice = film.bytes.slice(part * plan.chunkBytes, (part + 1) * plan.chunkBytes);
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(`/api/books/${bookId}/media/meta/video/upload?upload=${plan.uploadId}&part=${part}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: slice,
      }).catch(() => null);
      if (response?.ok) break;
      if (attempt >= 3 || response?.status === 409) throw new Error((await response?.json().catch(() => null))?.error ?? "the upload failed");
      await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
    }
    onProgress({ stage: "upload", percent: Math.round(((part + 1) / parts) * 100), note: `Saving the film (${part + 1} of ${parts})` });
  }
  const response = await fetch(`/api/books/${bookId}/media/meta/video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "finish", uploadId: plan.uploadId, parts, ms: plan.totalMs, codec: film.codec }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? "the film could not be saved");
  return data;
}
