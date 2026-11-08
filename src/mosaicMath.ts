import type { Direction } from "./library";
export const quadrants: Record<Direction, [number, number]> = {
  front: [0, 0],
  rear: [1, 0],
  left: [0, 1],
  right: [1, 1],
};
/** Perspective plane to an equidistant lens; input/output use top-left origin. */
export function lensPoint(
  u: number,
  v: number,
  fov: number,
  strength: number,
  aspect = 1.25,
): [number, number] {
  const scale = Math.tan((fov * Math.PI) / 360);
  const x = (u * 2 - 1) * scale;
  const y = ((v * 2 - 1) * scale) / aspect;
  const r = Math.hypot(x, y);
  const k = r > 1e-8 ? Math.atan(r) / r / Math.PI : 1 / Math.PI;
  return [u + (0.5 + x * k - u) * strength, v + (0.5 + y * k * aspect - v) * strength];
}
