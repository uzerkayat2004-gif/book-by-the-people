"use client";

import { useEffect, useRef, useState } from "react";
import { isLand } from "@/lib/land-mask";

type Pin = { name: string; lat: number; lng: number };

/** Globe radius as a share of the canvas width. The CSS rim glow in globe.css follows it. */
const R = 0.47;

/** Evenly spaced points on the sphere (Fibonacci lattice), kept where the map has land. */
function landPoints(samples: number): [number, number][] {
  const out: [number, number][] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let index = 0; index < samples; index += 1) {
    const y = 1 - ((index + 0.5) / samples) * 2;
    const lat = (Math.asin(y) * 180) / Math.PI;
    const lng = ((((index * golden * 180) / Math.PI) % 360) + 540) % 360 - 180;
    if (Math.abs(lat) < 84 && isLand(lat, lng)) out.push([lat, lng]);
  }
  return out;
}
const DOTS = landPoints(38000);

function project(lat: number, lng: number, phi: number, theta: number) {
  const la = (lat * Math.PI) / 180;
  const lo = (lng * Math.PI) / 180 - Math.PI;
  const o = Math.cos(la);
  const radius = R * 2;
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
  const phiRef = useRef(-3.1);
  const thetaRef = useRef(0.42);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [tip, setTip] = useState<{ name: string; x: number; y: number; left: boolean } | null>(null);
  const pinsRef = useRef(pins);
  useEffect(() => {
    pinsRef.current = pins;
  }, [pins]);

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
      if (flat.width !== size * dpr || flat.height !== size * dpr) {
        flat.width = size * dpr;
        flat.height = size * dpr;
      }
      const ctx = flat.getContext("2d");
      if (!ctx) return;
      const width = flat.width;
      ctx.clearRect(0, 0, width, width);
      const phi = phiRef.current;
      const theta = thetaRef.current;
      const radius = width * R;
      const cx = width / 2;
      const cy = width / 2;
      // Sphere body: near-black, lit to a soft grey toward the lower right like the live globe.
      const shade = ctx.createRadialGradient(cx + radius * 0.18, cy + radius * 0.28, radius * 0.05, cx, cy, radius);
      shade.addColorStop(0, "#26282d");
      shade.addColorStop(0.6, "#16171b");
      shade.addColorStop(1, "#0b0c0e");
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius - 0.5, 0, Math.PI * 2);
      ctx.clip();
      const dot = Math.max(1.1, width * 0.0055);
      ctx.fillStyle = "#f4f3f0";
      for (const [lat, lng] of DOTS) {
        const point = project(lat, lng, phi, theta);
        if (point.depth < 0.01) continue;
        const facing = point.depth / (R * 2);
        ctx.globalAlpha = Math.min(1, 0.3 + facing * 1.05);
        const size = dot * (0.55 + 0.45 * facing);
        ctx.fillRect(point.x * width - size / 2, point.y * width - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
      const drawn: Pin[] = [];
      for (const pin of pinsRef.current) {
        // One marker per place: voices from the same area share a dot, as on the live globe.
        if (drawn.some((other) => Math.abs(other.lat - pin.lat) < 6 && Math.abs(other.lng - pin.lng) < 6)) continue;
        drawn.push(pin);
        const point = project(pin.lat, pin.lng, phi, theta);
        if (point.depth < 0.04) continue;
        const px = point.x * width;
        const py = point.y * width;
        const r = Math.max(2.2, width * 0.0085);
        const glow = ctx.createRadialGradient(px, py, 0, px, py, r * 3);
        glow.addColorStop(0, "rgba(255,59,48,.55)");
        glow.addColorStop(1, "rgba(255,59,48,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(px, py, r * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ff2d24";
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      // Red rim: a thin bright line with a soft outer glow.
      ctx.save();
      ctx.shadowColor = "rgba(229,56,59,.9)";
      ctx.shadowBlur = width * 0.045;
      ctx.strokeStyle = "rgba(236,72,72,.95)";
      ctx.lineWidth = Math.max(1, width * 0.004);
      for (let pass = 0; pass < 2; pass += 1) {
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      ctx.restore();
      frame = requestAnimationFrame(draw);
    };
    draw(performance.now());
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

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
      <canvas
        ref={flatRef}
        aria-label="Globe: one dot for every person who spoke"
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
