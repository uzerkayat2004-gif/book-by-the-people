"use client";

import { useEffect, useRef, useState } from "react";
import createGlobe from "cobe";
import landDots from "@/lib/land-dots.json";

type Pin = { name: string; lat: number; lng: number };

const BASE = (landDots as [number, number][]).filter(([lat]) => Math.abs(lat) < 78);
const DOTS: [number, number][] = [];
for (const [lat, lng] of BASE) {
  for (let row = -2; row <= 2; row += 1) {
    for (let col = -2; col <= 2; col += 1) {
      DOTS.push([lat + row * 0.42, lng + col * 0.55]);
    }
  }
}

function project(lat: number, lng: number, phi: number, theta: number) {
  const la = (lat * Math.PI) / 180;
  const lo = (lng * Math.PI) / 180 - Math.PI;
  const o = Math.cos(la);
  const radius = 0.8;
  const x = -o * Math.cos(lo) * radius;
  const y = Math.sin(la) * radius;
  const z = o * Math.sin(lo) * radius;
  const ct = Math.cos(theta);
  const cp = Math.cos(phi);
  const st = Math.sin(theta);
  const sp = Math.sin(phi);
  const cx = cp * x + sp * z;
  const cy = sp * st * x + ct * y - cp * st * z;
  const depth = -sp * ct * x + st * y + cp * ct * z;
  return { x: (cx + 1) / 2, y: (-cy + 1) / 2, depth };
}

export function GlobeView({ pins }: { pins: Pin[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const flatRef = useRef<HTMLCanvasElement>(null);
  const webRef = useRef<HTMLCanvasElement>(null);
  const phiRef = useRef(-2.8816);
  const thetaRef = useRef(0.34);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [tip, setTip] = useState<{ name: string; x: number; y: number; left: boolean } | null>(null);
  const [webgl, setWebgl] = useState(false);
  const pinsRef = useRef(pins);
  pinsRef.current = pins;

  useEffect(() => {
    const flat = flatRef.current;
    const wrap = wrapRef.current;
    if (!flat || !wrap) return;
    let frame = 0;
    let last = 0;
    const draw = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      const frozen = document.documentElement.classList.contains("static");
      if (!drag.current && !frozen) phiRef.current += 0.11 * dt;
      const size = Math.max(80, Math.round(wrap.clientWidth));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (flat.width !== size * dpr) {
        flat.width = size * dpr;
        flat.height = size * dpr;
      }
      const ctx = flat.getContext("2d");
      if (!ctx) return;
      const width = flat.width;
      ctx.clearRect(0, 0, width, width);
      const phi = phiRef.current;
      const theta = thetaRef.current;
      const radius = width * 0.4;
      const cx = width / 2;
      const cy = width / 2;
      const shade = ctx.createRadialGradient(cx - radius * 0.32, cy - radius * 0.34, radius * 0.08, cx, cy, radius);
      shade.addColorStop(0, "#2a2c33");
      shade.addColorStop(0.55, "#14161a");
      shade.addColorStop(1, "#090a0c");
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius - 1, 0, Math.PI * 2);
      ctx.clip();
      ctx.strokeStyle = "rgba(236,238,242,.95)";
      ctx.lineWidth = Math.max(0.7, width * 0.0011);
      ctx.lineCap = "round";
      for (const [lat, lng] of DOTS) {
        const point = project(lat, lng, phi, theta);
        if (point.depth < 0.04) continue;
        const px = point.x * width;
        const py = point.y * width;
        const hatch = Math.max(1.4, width * 0.0034 * (0.55 + point.depth));
        ctx.globalAlpha = 0.35 + point.depth * 0.6;
        ctx.beginPath();
        ctx.moveTo(px - hatch, py + hatch * 0.35);
        ctx.lineTo(px + hatch * 0.2, py - hatch);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (const pin of pinsRef.current) {
        const point = project(pin.lat, pin.lng, phi, theta);
        if (point.depth < 0.08) continue;
        ctx.beginPath();
        ctx.fillStyle = "rgba(255,70,66,.95)";
        ctx.arc(point.x * width, point.y * width, Math.max(2.4, width * 0.009), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      frame = requestAnimationFrame(draw);
    };
    draw(performance.now());
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const canvas = webRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let globe: { destroy?: () => void } | null = null;
    let alive = true;
    try {
      const css = Math.max(200, Math.round(wrap.clientWidth));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const size = Math.round(css * dpr);
      globe = createGlobe(canvas, {
        devicePixelRatio: dpr,
        width: size,
        height: size,
        phi: phiRef.current,
        theta: 0.34,
        dark: 1,
        diffuse: 1.45,
        mapSamples: 90000,
        mapBrightness: 11,
        mapBaseBrightness: 0.035,
        baseColor: [0.14, 0.14, 0.16],
        markerColor: [1, 0.26, 0.25],
        glowColor: [0.42, 0.08, 0.09],
        markers: pinsRef.current.map((pin) => ({ location: [pin.lat, pin.lng], size: 0.025 })),
        opacity: 0.97,
        onRender: (state) => {
          state.phi = phiRef.current;
          state.theta = thetaRef.current;
          if (!alive) return;
        },
      });
      const check = window.setTimeout(() => {
        try {
          const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
          if (!gl) return;
          const pixel = new Uint8Array(4);
          gl.readPixels(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          if (pixel[3] > 8) setWebgl(true);
        } catch {
          setWebgl(false);
        }
      }, 700);
      return () => {
        alive = false;
        window.clearTimeout(check);
        globe?.destroy?.();
      };
    } catch {
      return () => {
        alive = false;
      };
    }
  }, [pins]);

  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    drag.current = { x: event.clientX, y: event.clientY, moved: false };
  }
  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const current = drag.current;
    if (!current) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.moved && Math.hypot(dx, dy) < 6) return;
    current.moved = true;
    const size = wrapRef.current?.clientWidth || 400;
    const k = Math.PI / Math.max(240, size);
    phiRef.current += dx * k;
    thetaRef.current = Math.max(-1.05, Math.min(1.05, thetaRef.current + dy * k));
    current.x = event.clientX;
    current.y = event.clientY;
  }
  function pointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    const current = drag.current;
    drag.current = null;
    if (!current || current.moved) {
      setTip(null);
      return;
    }
    const canvas = flatRef.current;
    if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    const mx = (event.clientX - box.left) / box.width;
    const my = (event.clientY - box.top) / box.height;
    let best = -1;
    let bestD = 0.04;
    pinsRef.current.forEach((pin, index) => {
      const point = project(pin.lat, pin.lng, phiRef.current, thetaRef.current);
      if (point.depth < 0.08) return;
      const d = (point.x - mx) ** 2 + (point.y - my) ** 2;
      if (d < bestD) {
        bestD = d;
        best = index;
      }
    });
    if (best < 0) {
      setTip(null);
      return;
    }
    const pin = pinsRef.current[best];
    const point = project(pin.lat, pin.lng, phiRef.current, thetaRef.current);
    const size = canvas.getBoundingClientRect().width;
    setTip({ name: pin.name, x: point.x * size, y: point.y * size, left: point.x > 0.62 });
  }

  return (
    <div className="gwrap ready" ref={wrapRef}>
      <div className="gwrap__atmo" />
      <canvas
        ref={webRef}
        style={{ opacity: webgl ? 1 : 0, position: "absolute", inset: 0 }}
        aria-hidden={webgl ? undefined : true}
      />
      <canvas
        ref={flatRef}
        aria-label="Globe: one dot for every person who spoke"
        style={{ opacity: webgl ? 0 : 1 }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={() => {
          drag.current = null;
        }}
      />
      <div className="gwrap__ov">
        <div className={`gtip${tip ? " on" : ""}${tip?.left ? " l" : ""}`} style={tip ? { transform: `translate3d(${tip.x}px, ${tip.y}px, 0)` } : undefined}>
          <span>{tip?.name}</span>
        </div>
      </div>
    </div>
  );
}
