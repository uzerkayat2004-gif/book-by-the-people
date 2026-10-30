"use client";

import { useEffect, useRef } from "react";
import { GLOBE_DOTS } from "@/lib/globe-dots";

type Pin = { name: string; lat: number; lng: number };

/** Sphere radius in the [-1, 1] view, as on the live globe (0.805 → 40.25% of the canvas width). */
const RADIUS = 0.805;
/** Start facing India (lng 79), tilted slightly toward the viewer. */
const START_LNG = 79;
const REST_THETA = 0.3;
const MIN_THETA = -0.6;
const MAX_THETA = 0.9;
/** Slow auto-spin (radians per second) once the globe has been left alone for a moment. */
const SPIN = 0.157;
const IDLE_MS = 2500;
const TAP_MS = 600;
const TAP_MOVE = 6;
const PICK_MOUSE = 12;
const PICK_TOUCH = 18;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const phiFacing = (lng: number) => Math.PI / 2 - ((lng * Math.PI) / 180 - Math.PI);
const angleDelta = (from: number, to: number) => {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
};

/** Orthographic projection to canvas pixels; depth > 0 is the visible side. */
function project(lat: number, lng: number, phi: number, theta: number, size: number, scale = 1) {
  const la = (lat * Math.PI) / 180;
  const lo = (lng * Math.PI) / 180 - Math.PI;
  const o = Math.cos(la);
  const r = RADIUS * scale;
  const x = -o * Math.cos(lo) * r;
  const y = Math.sin(la) * r;
  const z = o * Math.sin(lo) * r;
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  const px = cp * x + sp * z;
  const py = sp * st * x + ct * y - cp * st * z;
  const depth = -sp * ct * x + st * y + cp * ct * z;
  return { x: ((px + 1) / 2) * size, y: ((-py + 1) / 2) * size, depth };
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

/** Pre-renders the sphere body and the red rim light once per size. */
function paintBody(size: number, dpr: number) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.round(size * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.imageSmoothingQuality = "high";
  ctx.scale(dpr, dpr);
  const c = size / 2;
  const r = (RADIUS * size) / 2;
  // Body: |n.z| shading, dark at the limb and a touch lighter in the middle.
  const body = ctx.createRadialGradient(c, c, 0, c, c, r);
  for (let step = 0; step <= 24; step += 1) {
    const t = step / 24;
    const f = Math.sqrt(Math.max(0, 1 - t * t));
    const k = smoothstep(0.55, 1, f);
    body.addColorStop(t, `rgb(${mix(10, 28, k)},${mix(11, 30, k)},${mix(13, 36, k)})`);
  }
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();
  // Rim light: a 1.02× shell lit by (1 - |n.z|)^3.5, added on top (colour × alpha, as additive blending does).
  const shell = r * 1.02;
  const rim = ctx.createRadialGradient(c, c, 0, c, c, shell);
  for (let step = 0; step <= 40; step += 1) {
    const t = 0.6 + (step / 40) * 0.4;
    const f = Math.pow(1 - Math.sqrt(Math.max(0, 1 - t * t)), 3.5);
    rim.addColorStop(t, `rgba(${Math.round(235 * f)},${Math.round(61 * f)},${Math.round(66 * f)},${(f * 0.85).toFixed(3)})`);
  }
  rim.addColorStop(0, "rgba(235,61,66,0)");
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(c, c, shell, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}

export function GlobeView({ pins }: { pins: Pin[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const selRef = useRef<HTMLDivElement>(null);
  const pinsRef = useRef(pins);
  useEffect(() => {
    pinsRef.current = pins;
  }, [pins]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const state = {
      phi: phiFacing(START_LNG),
      theta: REST_THETA,
      vPhi: 0,
      vTheta: 0,
      dragging: false,
      selected: -1,
      lastInput: -Infinity,
      size: 0,
      dpr: 1,
      body: null as HTMLCanvasElement | null,
    };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Phones and small screens: fewer dots, lower density, 30 fps.
    const lite = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 700;
    const stride = lite ? 4 : 2;
    const minFrameMs = lite ? 33 : 0;
    let drawn = { phi: NaN, theta: NaN, size: 0, pins: null as unknown, selected: -2 };
    let drag: { id: number; lx: number; ly: number; t: number; moved: number; mouse: boolean } | null = null;

    const resize = () => {
      const size = Math.max(80, Math.round(wrap.clientWidth || 320));
      // Desktops render at 2x for crisp round dots; phones cap at 1.5x, which looks the same
      // at their size and costs well under half the pixels.
      const dpr = lite ? clamp(window.devicePixelRatio || 1, 1, 1.5) : clamp(Math.max(2, window.devicePixelRatio || 1), 2, 2.5);
      if (size === state.size && dpr === state.dpr && state.body) return;
      state.size = size;
      state.dpr = dpr;
      canvas.width = canvas.height = Math.round(size * dpr);
      state.body = paintBody(size, dpr);
    };

    const render = () => {
      const { size, dpr, phi, theta } = state;
      if (!size) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (state.body) ctx.drawImage(state.body, 0, 0);
      // Land dots, front side only: round, anti-aliased, and slightly dimmer toward the edge
      // (three brightness bands, one path each) so the sphere reads as 3D without blur.
      const radius = ((Math.max(1.05, size * 0.0029) * dpr) / 2) * (lite ? 1.3 : 1);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const bands = [new Path2D(), new Path2D(), new Path2D()];
      for (let index = 0; index < GLOBE_DOTS.length; index += stride) {
        const point = project(GLOBE_DOTS[index], GLOBE_DOTS[index + 1], phi, theta, size, 1.004);
        if (point.depth <= 0) continue;
        const x = point.x * dpr;
        const y = point.y * dpr;
        const depth = point.depth / RADIUS;
        const band = depth > 0.55 ? 0 : depth > 0.25 ? 1 : 2;
        // Dots shrink a little toward the limb, like real foreshortening.
        const r = radius * (0.7 + 0.3 * Math.min(1, depth * 1.6));
        bands[band].moveTo(x + r, y);
        bands[band].arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.fillStyle = "rgba(240,237,229,1)";
      ctx.fill(bands[0]);
      ctx.fillStyle = "rgba(240,237,229,.78)";
      ctx.fill(bands[1]);
      ctx.fillStyle = "rgba(240,237,229,.5)";
      ctx.fill(bands[2]);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Voices: red dots.
      const marker = Math.max(5.5, size * 0.0125) / 2;
      ctx.fillStyle = "#ff4340";
      ctx.beginPath();
      for (const pin of pinsRef.current) {
        const point = project(pin.lat, pin.lng, phi, theta, size, 1.012);
        if (point.depth <= 0) continue;
        ctx.moveTo(point.x + marker, point.y);
        ctx.arc(point.x, point.y, marker, 0, Math.PI * 2);
      }
      ctx.fill();
    };

    const placeTip = () => {
      const tip = tipRef.current;
      const sel = selRef.current;
      if (!tip) return;
      const pin = state.selected >= 0 ? pinsRef.current[state.selected] : undefined;
      if (!pin) {
        tip.classList.remove("on");
        sel?.classList.add("hid");
        return;
      }
      const point = project(pin.lat, pin.lng, state.phi, state.theta, state.size);
      const transform = `translate3d(${point.x}px,${point.y}px,0)`;
      tip.style.transform = transform;
      tip.classList.add("on");
      tip.classList.toggle("hid", point.depth < 0.05);
      tip.classList.toggle("l", point.x > state.size * 0.62);
      if (sel) {
        sel.style.transform = transform;
        sel.classList.toggle("hid", point.depth < 0.05);
      }
    };

    const step = (dt: number, now: number) => {
      if (!state.dragging && (Math.abs(state.vPhi) > 0.02 || Math.abs(state.vTheta) > 0.02)) {
        // Fling: keep turning after release and slow down.
        state.phi += state.vPhi * dt;
        state.theta = clamp(state.theta + state.vTheta * dt, MIN_THETA, MAX_THETA);
        const decay = Math.exp(-2.2 * dt);
        state.vPhi *= decay;
        state.vTheta *= decay;
        if (Math.abs(state.vPhi) <= 0.02 && Math.abs(state.vTheta) <= 0.02) {
          state.vPhi = 0;
          state.vTheta = 0;
          state.lastInput = now;
        }
      } else if (!state.dragging && state.selected < 0 && !reduced && now - state.lastInput > IDLE_MS) {
        state.phi += SPIN * dt;
        state.theta += (REST_THETA - state.theta) * (1 - Math.exp(-3 * dt));
      }
      // Only draw when something moved.
      if (drawn.phi === state.phi && drawn.theta === state.theta && drawn.size === state.size && drawn.pins === pinsRef.current && drawn.selected === state.selected) return;
      drawn = { phi: state.phi, theta: state.theta, size: state.size, pins: pinsRef.current, selected: state.selected };
      render();
      placeTip();
    };

    let frame = 0;
    let last = 0;
    let stopped = false;
    let onScreen = true;
    const loop = (now: number) => {
      frame = 0;
      if (stopped || !onScreen || document.hidden) return;
      if (minFrameMs && last && now - last < minFrameMs && !state.dragging) {
        frame = requestAnimationFrame(loop);
        return;
      }
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;
      step(dt, now);
      frame = requestAnimationFrame(loop);
    };
    const wake = () => {
      if (stopped || frame || !onScreen || document.hidden) return;
      last = 0;
      frame = requestAnimationFrame(loop);
    };
    resize();
    render();
    frame = requestAnimationFrame(loop);
    // Pause when the globe is scrolled away or the tab is hidden.
    const seen = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting);
      wake();
    });
    seen?.observe(wrap);
    document.addEventListener("visibilitychange", wake);
    const observer = new ResizeObserver(() => {
      resize();
      render();
    });
    observer.observe(wrap);

    const endDrag = () => {
      drag = null;
      state.dragging = false;
      wrap.classList.remove("gwrap--drag");
    };
    const select = (index: number) => {
      state.selected = index;
      state.lastInput = performance.now();
      const span = tipRef.current?.firstElementChild;
      if (span) span.textContent = index >= 0 ? (pinsRef.current[index]?.name ?? "") : "";
    };

    const onDown = (event: PointerEvent) => {
      // Mouse: left button only. Touch and pen always start a drag.
      if (event.pointerType === "mouse" && event.button !== 0) return;
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Capture can fail if the pointer is already gone; the drag still works inside the canvas.
      }
      drag = { id: event.pointerId, lx: event.clientX, ly: event.clientY, t: performance.now(), moved: 0, mouse: event.pointerType === "mouse" };
      state.dragging = true;
      state.vPhi = 0;
      state.vTheta = 0;
      state.lastInput = performance.now();
      wrap.classList.add("gwrap--drag");
    };
    const onMove = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId || !state.size) return;
      // The left button is no longer held (released outside the window, etc.): stop dragging.
      if (drag.mouse && (event.buttons & 1) === 0) {
        endDrag();
        state.vPhi = 0;
        state.vTheta = 0;
        state.lastInput = performance.now();
        return;
      }
      const dx = event.clientX - drag.lx;
      const dy = event.clientY - drag.ly;
      drag.lx = event.clientX;
      drag.ly = event.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.moved <= TAP_MOVE) return;
      if (state.selected >= 0) select(-1);
      const touch = event.pointerType === "touch";
      state.phi += (dx / state.size) * Math.PI;
      if (!touch) state.theta = clamp(state.theta + (dy / state.size) * Math.PI, MIN_THETA, MAX_THETA);
      state.vPhi = (dx / state.size) * Math.PI * 60;
      state.vTheta = touch ? 0 : (dy / state.size) * Math.PI * 60;
      state.lastInput = performance.now();
    };
    const onUp = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return;
      const tap = drag.moved < TAP_MOVE && performance.now() - drag.t < TAP_MS;
      endDrag();
      state.lastInput = performance.now();
      if (!tap) return;
      state.vPhi = 0;
      state.vTheta = 0;
      const box = canvas.getBoundingClientRect();
      const mx = event.clientX - box.left;
      const my = event.clientY - box.top;
      let best = -1;
      let bestDistance = event.pointerType === "touch" ? PICK_TOUCH : PICK_MOUSE;
      pinsRef.current.forEach((pin, index) => {
        const point = project(pin.lat, pin.lng, state.phi, state.theta, state.size);
        if (point.depth < 0.05) return;
        const distance = Math.hypot(point.x - mx, point.y - my);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });
      select(best >= 0 && best !== state.selected ? best : -1);
    };
    const onCancel = () => {
      endDrag();
      state.vPhi = 0;
      state.vTheta = 0;
    };
    const onLost = (event: PointerEvent) => {
      if (drag && drag.id === event.pointerId) onCancel();
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);
    canvas.addEventListener("lostpointercapture", onLost);
    window.addEventListener("blur", onCancel);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      seen?.disconnect();
      document.removeEventListener("visibilitychange", wake);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("lostpointercapture", onLost);
      window.removeEventListener("blur", onCancel);
    };
  }, []);

  return (
    <div className="gwrap ready" ref={wrapRef}>
      <div className="gwrap__atmo" />
      <canvas ref={canvasRef} aria-label="Globe: one dot for every person who spoke" />
      <div className="gwrap__ov">
        <div className="gsel hid" ref={selRef} aria-hidden="true" />
        <div className="gtip" ref={tipRef} role="status" aria-live="polite">
          <span />
        </div>
      </div>
    </div>
  );
}
