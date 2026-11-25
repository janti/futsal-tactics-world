/** Scalar helpers shared by simulation, camera and rendering. Pure functions, no allocation. */

export const TAU = Math.PI * 2

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

export function clamp01(v: number): number {
  return clamp(v, 0, 1)
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Map an attribute on the 1–100 scale onto [min, max]. */
export function attr(value: number, min: number, max: number): number {
  return lerp(min, max, clamp01((value - 1) / 99))
}

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  let r = a % TAU
  if (r <= -Math.PI) r += TAU
  else if (r > Math.PI) r -= TAU
  return r
}

/** Signed shortest difference b - a. */
export function angleDiff(a: number, b: number): number {
  return wrapAngle(b - a)
}

/** Rotate angle `from` towards `to` by at most `maxStep` radians. */
export function turnTowards(from: number, to: number, maxStep: number): number {
  const d = angleDiff(from, to)
  if (Math.abs(d) <= maxStep) return wrapAngle(to)
  return wrapAngle(from + Math.sign(d) * maxStep)
}

export function lerpAngle(a: number, b: number, t: number): number {
  return wrapAngle(a + angleDiff(a, b) * t)
}

/**
 * Frame-rate independent exponential smoothing factor.
 * `smoothTime` is the time constant in seconds (about 63% of the way after smoothTime).
 */
export function dampFactor(smoothTime: number, dt: number): number {
  if (smoothTime <= 0) return 1
  return 1 - Math.exp(-dt / smoothTime)
}

export function damp(current: number, target: number, smoothTime: number, dt: number): number {
  return lerp(current, target, dampFactor(smoothTime, dt))
}

/** Probability that an event with `ratePerSecond` happens at least once within `dt`. */
export function rateToChance(ratePerSecond: number, dt: number): number {
  return 1 - Math.exp(-Math.max(0, ratePerSecond) * dt)
}
