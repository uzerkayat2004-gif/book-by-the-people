"use client";

import { useEffect, useState } from "react";

const LOGO_P = [
  "M8 27C15 23.2 23.2 23.4 30.4 27.8V51.5C23.2 47.2 15 47 8 50.6Z",
  "M56 27C49 23.2 40.8 23.4 33.6 27.8V51.5C40.8 47.2 49 47 56 50.6Z",
];
const LOGO_B: [number, number, number, number][] = [
  [21.6, 13.5, 4.8, 7.5],
  [29.6, 8, 4.8, 13],
  [37.6, 13.5, 4.8, 7.5],
];

export type ShareCardProps = {
  name: string;
  place: string;
  quote: string;
  chapter: number;
  chapterTitle: string;
  similar: number;
  theme: string;
  people: number;
  countries: number;
  names: string[];
  linkHost: string;
  pageUrl: string;
};

function roundRect(x: CanvasRenderingContext2D, X: number, Y: number, w: number, h: number, r: number) {
  x.beginPath();
  x.moveTo(X + r, Y);
  x.arcTo(X + w, Y, X + w, Y + h, r);
  x.arcTo(X + w, Y + h, X, Y + h, r);
  x.arcTo(X, Y + h, X, Y, r);
  x.arcTo(X, Y, X + w, Y, r);
  x.closePath();
}

function wrapLines(x: CanvasRenderingContext2D, text: string, maxW: number) {
  const words = text.split(" ");
  const out: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (x.measureText(test).width > maxW && line) {
      out.push(line);
      line = word;
    } else line = test;
  }
  if (line) out.push(line);
  return out;
}

function fitText(x: CanvasRenderingContext2D, text: string, font: (size: number) => string, maxW: number, maxH: number, start: number, min: number, lhK: number) {
  for (let size = start; size >= min; size -= 2) {
    x.font = font(size);
    const lines = wrapLines(x, text, maxW);
    if (lines.length * size * lhK <= maxH) return { size, lines };
  }
  x.font = font(min);
  return { size: min, lines: wrapLines(x, text, maxW) };
}

function drawLogo(x: CanvasRenderingContext2D, X: number, Y: number, size: number, background = true) {
  x.save();
  x.translate(X, Y);
  x.scale(size / 64, size / 64);
  if (background) {
    const paint = x.createLinearGradient(0, 0, 64, 64);
    paint.addColorStop(0, "#ef4a4c");
    paint.addColorStop(0.55, "#c92e34");
    paint.addColorStop(1, "#8e161c");
    x.fillStyle = paint;
    roundRect(x, 0, 0, 64, 64, 15);
    x.fill();
  }
  x.fillStyle = "#fff";
  for (const path of LOGO_P) x.fill(new Path2D(path));
  for (const [a, b, w, h] of LOGO_B) {
    roundRect(x, a, b, w, h, w / 2);
    x.fill();
  }
  x.restore();
}

function drawMiniBook(x: CanvasRenderingContext2D, X: number, Y: number, w: number, h: number, names: string, people: number) {
  const t = w * 0.09;
  x.save();
  x.shadowColor = "rgba(0,0,0,.55)";
  x.shadowBlur = w * 0.18;
  x.shadowOffsetY = w * 0.08;
  x.fillStyle = "#e9e4d8";
  x.beginPath();
  x.moveTo(X + w, Y + t * 0.5);
  x.lineTo(X + w + t, Y + t * 1.1);
  x.lineTo(X + w + t, Y + h + t * 0.2);
  x.lineTo(X + w, Y + h - t * 0.3);
  x.closePath();
  x.fill();
  x.restore();
  x.strokeStyle = "rgba(0,0,0,.12)";
  x.lineWidth = 1;
  for (let i = 1; i < 7; i += 1) {
    const k = i / 7;
    x.beginPath();
    x.moveTo(X + w + t * k, Y + t * (0.5 + 0.6 * k));
    x.lineTo(X + w + t * k, Y + h - t * 0.3 + t * 0.5 * k);
    x.stroke();
  }
  const cover = x.createLinearGradient(X, Y, X + w, Y + h);
  cover.addColorStop(0, "#e5383b");
  cover.addColorStop(0.6, "#a01c22");
  cover.addColorStop(1, "#3a0d12");
  x.fillStyle = cover;
  roundRect(x, X, Y, w, h, w * 0.03);
  x.fill();
  const spine = x.createLinearGradient(X, 0, X + w * 0.09, 0);
  spine.addColorStop(0, "rgba(0,0,0,.35)");
  spine.addColorStop(1, "rgba(255,255,255,.08)");
  x.fillStyle = spine;
  x.fillRect(X, Y, w * 0.09, h);
  x.fillStyle = "rgba(255,255,255,.1)";
  x.font = `500 ${Math.max(4, w * 0.028)}px "Geist Mono"`;
  for (let yy = Y + w * 0.05, i = 0; yy < Y + h * 0.42; yy += w * 0.034, i += 1) {
    x.fillText(names.slice((i * 37) % Math.max(names.length, 1), (i * 37) % Math.max(names.length, 1) + 200), X + w * 0.12, yy);
  }
  x.save();
  x.globalAlpha = 0.92;
  drawLogo(x, X + w * 0.14, Y + h * 0.08, w * 0.16, false);
  x.restore();
  x.fillStyle = "#fff";
  x.font = `800 ${w * 0.13}px "Archivo"`;
  x.fillText("BOOK BY", X + w * 0.14, Y + h * 0.56);
  x.fillText("THE PEOPLE", X + w * 0.14, Y + h * 0.56 + w * 0.14);
  x.fillStyle = "rgba(255,255,255,.85)";
  x.font = `italic 400 ${w * 0.07}px "Newsreader"`;
  x.fillText(`by ${people.toLocaleString("en-US")} people`, X + w * 0.14, Y + h * 0.88);
}

function brandRow(x: CanvasRenderingContext2D, X: number, Y: number, size: number) {
  drawLogo(x, X, Y - size * 0.86, size);
  x.fillStyle = "#f3f2ee";
  x.font = `800 ${size * 0.62}px "Archivo"`;
  x.fillText("BOOK BY THE PEOPLE", X + size * 1.3, Y - size * 0.2);
}

function drawCard(props: ShareCardProps, format: "portrait" | "x") {
  const wide = format === "x";
  const W = wide ? 1200 : 1080;
  const H = wide ? 630 : 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const x = canvas.getContext("2d");
  if (!x) return canvas;
  x.textBaseline = "alphabetic";
  const names = props.names.join(" · ") || props.name;
  x.fillStyle = "#0a0b0d";
  x.fillRect(0, 0, W, H);
  const glow = x.createRadialGradient(W * 0.85, H * 0.1, 10, W * 0.85, H * 0.1, W * 0.9);
  glow.addColorStop(0, "rgba(229,56,59,.42)");
  glow.addColorStop(0.5, "rgba(160,28,34,.14)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = glow;
  x.fillRect(0, 0, W, H);
  x.fillStyle = "rgba(255,255,255,.022)";
  x.font = '500 14px "Geist Mono"';
  for (let y = 22, i = 0; y < H; y += 20, i += 1) {
    const start = (i * 53) % Math.max(names.length, 1);
    x.fillText(names.slice(start, start + 260), -10, y);
  }
  x.strokeStyle = "rgba(255,255,255,.08)";
  x.lineWidth = 2;
  roundRect(x, 18, 18, W - 36, H - 36, 34);
  x.stroke();
  const kicker = `I'M IN CHAPTER ${props.chapter}`;
  const similar = `1 of ${props.similar.toLocaleString("en-US")} people who said ${props.theme.replace(/\.$/, "")}.`;
  if (!wide) {
    const M = 84;
    brandRow(x, M, 128, 46);
    x.save();
    x.translate(W - M - 210, 70);
    x.rotate(0.06);
    drawMiniBook(x, 0, 0, 190, 262, names, props.people);
    x.restore();
    x.fillStyle = "#ff5d57";
    x.font = '500 26px "Geist Mono"';
    x.fillText(kicker, M, 262);
    const title = fitText(x, props.chapterTitle, (size) => `500 ${size}px "Newsreader"`, W - 2 * M - 250, 200, 92, 60, 1.05);
    x.fillStyle = "#f3f2ee";
    x.font = `500 ${title.size}px "Newsreader"`;
    title.lines.forEach((line, index) => x.fillText(line, M, 352 + index * title.size * 1.05));
    const qTop = 352 + (title.lines.length - 1) * title.size * 1.05 + 70;
    const quote = fitText(x, props.quote, (size) => `italic 400 ${size}px "Newsreader"`, W - 2 * M - 80, 250, 60, 36, 1.3);
    const qText = quote.lines.length * quote.size * 1.3;
    const qH = 150 + qText + 64;
    x.fillStyle = "rgba(255,255,255,.05)";
    roundRect(x, M - 10, qTop, W - 2 * M + 20, qH, 30);
    x.fill();
    x.fillStyle = "#e5383b";
    x.fillRect(M - 10, qTop + 30, 6, qH - 60);
    x.fillStyle = "#ff5d57";
    x.font = '400 150px "Newsreader"';
    x.fillText("“", M + 30, qTop + 120);
    x.fillStyle = "#f3f2ee";
    x.font = `italic 400 ${quote.size}px "Newsreader"`;
    quote.lines.forEach((line, index) => x.fillText(line, M + 40, qTop + 150 + index * quote.size * 1.3));
    x.fillStyle = "#c3c4c9";
    x.font = '600 30px "Geist"';
    x.fillText(`— ${props.name}, ${props.place}`, M + 40, qTop + 150 + qText + 20);
    const sTop = qTop + qH + 72;
    x.fillStyle = "#f3f2ee";
    x.font = '600 36px "Geist"';
    wrapLines(x, similar, W - 2 * M)
      .slice(0, 2)
      .forEach((line, index) => x.fillText(line, M, sTop + index * 48));
    x.strokeStyle = "rgba(255,255,255,.12)";
    x.lineWidth = 2;
    x.beginPath();
    x.moveTo(M, H - 210);
    x.lineTo(W - M, H - 210);
    x.stroke();
    x.font = '700 26px "Geist"';
    const lw = x.measureText(props.linkHost).width + 48;
    x.fillStyle = "#f3f2ee";
    roundRect(x, M, H - 178, lw, 58, 29);
    x.fill();
    x.fillStyle = "#0a0b0d";
    x.fillText(props.linkHost, M + 24, H - 139);
    x.fillStyle = "rgba(255,255,255,.6)";
    x.font = '500 20px "Geist Mono"';
    x.fillText(`BOOK 1 · BY ${props.people.toLocaleString("en-US")} PEOPLE · ${props.countries} COUNTRIES`, M, H - 76);
  } else {
    const M = 64;
    x.save();
    x.translate(M + 6, 96);
    x.rotate(-0.05);
    drawMiniBook(x, 0, 0, 300, 414, names, props.people);
    x.restore();
    const L = 470;
    const RW = W - L - M;
    brandRow(x, L, 104, 36);
    x.fillStyle = "#ff5d57";
    x.font = '500 20px "Geist Mono"';
    x.fillText(`${kicker} · ${props.chapterTitle}`.toUpperCase(), L, 168);
    x.fillStyle = "#ff5d57";
    x.font = '400 110px "Newsreader"';
    x.fillText("“", L - 6, 268);
    const quote = fitText(x, props.quote, (size) => `italic 400 ${size}px "Newsreader"`, RW, 230, 46, 30, 1.28);
    x.fillStyle = "#f3f2ee";
    x.font = `italic 400 ${quote.size}px "Newsreader"`;
    quote.lines.forEach((line, index) => x.fillText(line, L + 44, 246 + index * quote.size * 1.28));
    const after = 246 + quote.lines.length * quote.size * 1.28 + 14;
    x.fillStyle = "#c3c4c9";
    x.font = '600 24px "Geist"';
    x.fillText(`— ${props.name}, ${props.place} · 1 of ${props.similar.toLocaleString("en-US")} who said this`, L + 44, after + 18);
    x.font = '700 22px "Geist"';
    const lw = x.measureText(props.linkHost).width + 40;
    x.fillStyle = "#f3f2ee";
    roundRect(x, L, H - 112, lw, 50, 25);
    x.fill();
    x.fillStyle = "#0a0b0d";
    x.fillText(props.linkHost, L + 20, H - 80);
  }
  return canvas;
}

export function ShareCard(props: ShareCardProps) {
  const [format, setFormat] = useState<"portrait" | "x">("portrait");
  const [src, setSrc] = useState("");
  const [blob, setBlob] = useState<Blob | null>(null);
  const namesKey = props.names.join("|");
  useEffect(() => {
    let gone = false;
    const card = props;
    void (async () => {
      try {
        await Promise.all(
          ['800 80px "Archivo"', '500 60px "Newsreader"', 'italic 400 40px "Newsreader"', '600 30px "Geist"', '500 26px "Geist Mono"'].map((font) => document.fonts.load(font)),
        );
      } catch {
        /* draw with whatever is ready */
      }
      if (gone) return;
      const canvas = drawCard(card, format);
      setSrc(canvas.toDataURL("image/png"));
      canvas.toBlob((next) => {
        if (!gone) setBlob(next);
      }, "image/png");
    })();
    return () => {
      gone = true;
    };
    // The card fields are the drawing inputs. `props` itself is a new object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format, namesKey, props.name, props.place, props.quote, props.chapter, props.chapterTitle, props.similar, props.theme, props.people, props.countries, props.linkHost]);
  const share = `https://twitter.com/intent/tweet?text=${encodeURIComponent("I'm featured in this book")}&url=${encodeURIComponent(props.pageUrl)}`;
  return (
    <>
      <div className="cardfmt" role="tablist">
        <button type="button" className={format === "portrait" ? "on" : ""} onClick={() => setFormat("portrait")}>
          Story · 1080×1350
        </button>
        <button type="button" className={format === "x" ? "on" : ""} onClick={() => setFormat("x")}>
          X post · 1200×630
        </button>
      </div>
      <div className={`sharewrap ${format}${src ? " ready" : ""}`}>
        {src ? <img className="sharecard4" src={src} alt={`Share card for ${props.name}`} /> : null}
        <div className="sharecard4__load">Drawing your card…</div>
      </div>
      <div className="sharebtns">
        <a className="btn btn--red btn--big btn--block" href={share} target="_blank" rel="noreferrer">
          Share on X
        </a>
        <button
          className="btn btn--ghost btn--block"
          type="button"
          disabled={!blob}
          onClick={() => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = format === "x" ? "book-by-the-people-1200x630.png" : "book-by-the-people-1080x1350.png";
            link.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download PNG
        </button>
      </div>
    </>
  );
}
