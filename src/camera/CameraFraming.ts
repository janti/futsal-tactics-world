import { clamp } from '../core/math/scalar'
import { COURT } from '../simulation/SimulationConfig'

export interface Frustum {
  /** Orthographic view width/height in world units (metres on the view plane). */
  width: number
  height: number
  /** Court length actually visible along the ground after aspect constraints. */
  visibleLength: number
}

/**
 * Orthographic frustum from the real viewport aspect ratio.
 * A ground length L seen at elevation e spans L * sin(e) of view height.
 * The full court width plus side margins always fits; if the desired length would cut the width
 * (portrait screens), the frustum grows and more length becomes visible instead.
 */
export function computeFrustum(
  aspect: number,
  visibleLength: number,
  elevationDeg: number,
  sideMargin: number,
): Frustum {
  const s = Math.sin((elevationDeg * Math.PI) / 180)
  const minWidth = COURT.width + sideMargin * 2
  let height = visibleLength * s
  let width = height * aspect
  if (width < minWidth) {
    width = minWidth
    height = width / aspect
  }
  return { width, height, visibleLength: height / s }
}

/** Clamp the camera's ground target so the view never drifts far past the goal lines. */
/** Default margin keeps the advertising boards (4 m behind the goal line) in view. */
export const CAMERA_END_MARGIN = 6

export function clampTargetY(y: number, visibleLength: number, margin = CAMERA_END_MARGIN): number {
  const bound = COURT.halfLength + margin
  const half = visibleLength / 2
  if (half >= bound) return 0
  return clamp(y, -(bound - half), bound - half)
}
