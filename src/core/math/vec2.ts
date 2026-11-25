/** Minimal 2D vector utilities. Simulation code favours small immutable values for clarity. */

export interface Vec2 {
  x: number
  y: number
}

export function vec2(x = 0, y = 0): Vec2 {
  return { x, y }
}

export function copy(a: Vec2): Vec2 {
  return { x: a.x, y: a.y }
}

export function assign(out: Vec2, a: Vec2): Vec2 {
  out.x = a.x
  out.y = a.y
  return out
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function scale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s }
}

/** a + b * s */
export function addScaled(a: Vec2, b: Vec2, s: number): Vec2 {
  return { x: a.x + b.x * s, y: a.y + b.y * s }
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y
}

export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x
}

export function lenSq(a: Vec2): number {
  return a.x * a.x + a.y * a.y
}

export function len(a: Vec2): number {
  return Math.sqrt(a.x * a.x + a.y * a.y)
}

export function distSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.sqrt(distSq(a, b))
}

export function normalize(a: Vec2): Vec2 {
  const l = len(a)
  return l > 1e-9 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 }
}

export function clampLen(a: Vec2, max: number): Vec2 {
  const l = len(a)
  return l > max && l > 0 ? { x: (a.x / l) * max, y: (a.y / l) * max } : { x: a.x, y: a.y }
}

export function lerpV(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

export function fromAngle(angle: number, length = 1): Vec2 {
  return { x: Math.cos(angle) * length, y: Math.sin(angle) * length }
}

export function angleOf(a: Vec2): number {
  return Math.atan2(a.y, a.x)
}

export function rotate(a: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c }
}

/** Perpendicular (rotated +90 degrees). */
export function perp(a: Vec2): Vec2 {
  return { x: -a.y, y: a.x }
}

/** Closest point to `p` on segment ab, plus the segment parameter t in [0,1]. */
export function closestOnSegment(a: Vec2, b: Vec2, p: Vec2): { point: Vec2; t: number } {
  const ab = sub(b, a)
  const l2 = lenSq(ab)
  const t = l2 > 1e-12 ? Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2)) : 0
  return { point: addScaled(a, ab, t), t }
}
