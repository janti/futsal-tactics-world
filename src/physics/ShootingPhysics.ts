import { attr, clamp, lerp } from '../core/math/scalar'
import type { SeededRandom } from '../core/random/SeededRandom'
import { dist, len, normalize, type Vec2 } from '../core/math/vec2'
import type { MatchState, PlayerState } from '../simulation/MatchState'
import { BALL, COURT, SHOT } from '../simulation/SimulationConfig'
import { pressureOn } from './PassingPhysics'

export interface ShotPlan {
  velocity: Vec2
  vz: number
  spin: number
  speed: number
  aim: Vec2
  /** Height of the ball's underside when it reaches the goal line (aim, before drag). */
  aimZ: number
  /** Quick, low, placed shot into a corner (a tap of the shoot button). */
  placed: boolean
}

/**
 * Intended height (underside, metres) of a shot at the goal for a given charge. The futsal ball is
 * heavy, so a little extra charge barely lifts it; only a long press raises it a lot, and a full
 * charge sends it over the 2 m crossbar.
 */
export function shotHeightForPower(power: number): number {
  const p = clamp(power, 0, 1)
  if (p <= SHOT.placedMaxPower) return SHOT.placedHeight
  const k = (p - SHOT.placedMaxPower) / (1 - SHOT.placedMaxPower)
  return SHOT.placedHeight + (SHOT.fullChargeHeight - SHOT.placedHeight) * Math.pow(k, SHOT.heightCurve)
}

/**
 * Plan a shot towards the opponent goal.
 * - Aim: the lateral (screen left/right) part of the direction input picks the corner on that side;
 *   without it the shooter aims at the side away from the goalkeeper.
 * - Tap (short press): a quick, low, accurate placed shot into the corner, Sensible Soccer style —
 *   the keeper cannot hold it, at best he parries it.
 * - Hold: more speed and more height; a long press lifts the heavy ball over the bar.
 * Error is seeded and attribute-driven, growing with distance, pressure and power.
 */
export function planShot(
  state: MatchState,
  shooter: PlayerState,
  dir: Vec2,
  power: number,
  rng: SeededRandom,
): ShotPlan {
  const attackDir = state.teams[shooter.team].attackDir
  const goalY = attackDir * COURT.halfLength
  const keeper = state.players.find((p) => p.team !== shooter.team && p.role === 'GK')
  const a = shooter.profile.attributes
  const p = clamp(power, 0, 1)
  const placed = p <= SHOT.placedMaxPower
  const inner = COURT.goalHalfWidth - (placed ? SHOT.placedInsidePost : SHOT.aimInsidePost)

  // Lateral (sim x) component of the input picks the corner on that side of the goal.
  const lateralInput = len(dir) > 0.2 ? normalize(dir).x : 0
  let aimX: number
  if (Math.abs(lateralInput) > 0.3) {
    aimX = Math.sign(lateralInput) * inner
  } else {
    const kx = keeper ? keeper.pos.x : 0
    aimX = kx > shooter.pos.x * 0.15 ? -inner : inner
  }

  const maxSpeed = attr(a.shotPower, SHOT.maxSpeed - 5, SHOT.maxSpeed)
  const speed = placed
    ? attr((a.shotAccuracy + a.finishing) / 2, SHOT.placedSpeed[0], SHOT.placedSpeed[1])
    : lerp(SHOT.placedSpeed[0], maxSpeed, (p - SHOT.placedMaxPower) / (1 - SHOT.placedMaxPower))
  const d = dist(shooter.pos, { x: aimX, y: goalY })
  const pressure = pressureOn(state, shooter)

  // Accuracy model (metres of aim error at the goal). Placed shots trade power for precision.
  const skill = attr((a.finishing + a.shotAccuracy) / 2, 1.0, 0.18)
  const sigma =
    skill *
    (0.35 + d / 14) *
    (placed ? 0.55 : 0.7 + p * 0.6) *
    (0.8 + pressure * 0.7) *
    attr(a.composure, 1.2, 0.85)
  const errX = rng.gaussian() * sigma
  const errZ = rng.gaussian() * sigma * (placed ? 0.12 : 0.4)
  const aim = { x: aimX + errX, y: goalY }
  const aimZ = clamp(shotHeightForPower(p) + errZ, 0, 3.2)

  const dirV = normalize({ x: aim.x - shooter.pos.x, y: aim.y - shooter.pos.y })
  const flight = d / (speed * 0.93)
  // vz so the ball's underside is at aimZ when it reaches the goal (ignoring drag, floor launch).
  const vz = clamp((aimZ + 0.5 * BALL.gravity * flight * flight) / flight, 0, 9)
  const spin = rng.gaussian() * 0.4 * (placed ? 0.4 : 1 - p * 0.5)
  return { velocity: { x: dirV.x * speed, y: dirV.y * speed }, vz, spin, speed, aim, aimZ, placed }
}
