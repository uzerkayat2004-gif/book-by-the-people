/** Globe geometry shared by the globe and its tests. */
/** Sphere radius in the [-1, 1] view, as on the live globe (0.805 → 40.25% of the canvas width). */
export const RADIUS = 0.805;
/** Start facing India (lng 79), tilted slightly toward the viewer. */
export const START_LNG = 79;
export const REST_THETA = 0.3;
export const MIN_THETA = -0.6;
export const MAX_THETA = 0.9;
/** Slow auto-spin (radians per second) once the globe has been left alone for a moment. */
export const SPIN = 0.157;
export const IDLE_MS = 2500;

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const phiFacing = (lng: number) => Math.PI / 2 - ((lng * Math.PI) / 180 - Math.PI);
export const angleDelta = (from: number, to: number) => {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
};

/** Orthographic projection to canvas pixels; depth > 0 is the visible side. */
export function project(lat: number, lng: number, phi: number, theta: number, size: number, scale = 1) {
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

