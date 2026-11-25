/**
 * The single shared coordinate conversion utility.
 *
 * Simulation space (metres, centred on the centre mark):
 *   x in [-10, 10]  court width
 *   y in [-20, 20]  court length (goal lines at y = +-20)
 *   z >= 0          height above the floor
 *
 * Three.js space:  X = sim x,  Y = sim z (up),  Z = sim y.
 *
 * This mapping swaps two axes, so it is a reflection. That is harmless as long as every
 * screen-relative calculation (input, radar, overlays) derives its basis from the actual camera
 * (see camera/ScreenToWorld.ts) instead of assuming "screen right = +x".
 *
 * Team-relative frame: each team has an attack direction `dir` (+1 or -1 along sim y).
 *   forward = (0, dir), right = (-dir, 0)
 * "right" is chosen so it is consistent under the 180 degree presentation rotation and matches the
 * screen when that team attacks towards the top of the screen.
 */
import type { Vec2 } from './math/vec2'

export interface Vec3Like {
  x: number
  y: number
  z: number
}

export function simToThree(x: number, y: number, z: number, out: Vec3Like): Vec3Like {
  out.x = x
  out.y = z
  out.z = y
  return out
}

export function threeToSim(p: Vec3Like): { x: number; y: number; z: number } {
  return { x: p.x, y: p.z, z: p.y }
}

/**
 * Sim facing angle (atan2 in sim x/y) -> Three.js rotation.y for a model built facing +Z.
 * A model facing +Z rotated by phi about Y faces (sin phi, cos phi) in (X, Z) = sim (x, y).
 */
export function facingToThreeYaw(facing: number): number {
  return Math.PI / 2 - facing
}

/** Normalised team-relative coordinates: lateral in [-1, 1] (team right = +1), depth in [0, 1] (own goal = 0). */
export interface TeamRelative {
  lateral: number
  depth: number
}

export function teamToWorld(
  rel: TeamRelative,
  attackDir: 1 | -1,
  halfWidth: number,
  halfLength: number,
): Vec2 {
  return {
    x: -attackDir * rel.lateral * halfWidth,
    y: attackDir * (rel.depth * 2 - 1) * halfLength,
  }
}

export function worldToTeam(p: Vec2, attackDir: 1 | -1, halfWidth: number, halfLength: number): TeamRelative {
  return {
    lateral: (-attackDir * p.x) / halfWidth,
    depth: ((attackDir * p.y) / halfLength + 1) / 2,
  }
}
