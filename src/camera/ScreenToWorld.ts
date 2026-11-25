import type { Camera } from 'three'
import type { Vec2 } from '../core/math/vec2'

/** Screen axes expressed as unit directions on the court plane in simulation coordinates. */
export interface ScreenBasis {
  right: Vec2
  up: Vec2
}

/**
 * Basis for the vertical cameras: `upSign` is the sim y direction shown at the top of the screen.
 * With Three.js Z = sim y and the camera looking along +-Z, screen right maps to sim (-upSign, 0).
 */
export function basisForOrientation(upSign: 1 | -1): ScreenBasis {
  return { right: { x: -upSign, y: 0 }, up: { x: 0, y: upSign } }
}

/** Derive the basis from an actual camera (works for any rotation without roll). */
export function basisFromCamera(camera: Camera): ScreenBasis {
  camera.updateMatrixWorld()
  const e = camera.matrixWorld.elements
  // Column 0 = camera right, column 1 = camera up (world space). Project onto the floor (Three XZ).
  const rx = e[0]!
  const rz = e[2]!
  const ux = e[4]!
  const uz = e[6]!
  const rl = Math.hypot(rx, rz) || 1
  const ul = Math.hypot(ux, uz) || 1
  return { right: { x: rx / rl, y: rz / rl }, up: { x: ux / ul, y: uz / ul } }
}

/** Convert a screen-space stick/keyboard vector (x right, y up) into a sim-space direction. */
export function screenToSimDirection(input: Vec2, basis: ScreenBasis): Vec2 {
  return {
    x: basis.right.x * input.x + basis.up.x * input.y,
    y: basis.right.y * input.x + basis.up.y * input.y,
  }
}
