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
  aimZ: number
}

/**
 * Plan a shot towards the opponent goal.
 * - Lateral input picks the corner (input already in sim space, so "towards screen right" stays consistent).
 * - Without lateral input the shooter aims at the side away from the goalkeeper.
 * - Power (0..1) trades speed against accuracy; error grows with distance and pressure.
 * Error is seeded and attribute-driven so good decisions are rewarded and outcomes stay learnable.
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
  const inner = COURT.goalHalfWidth - SHOT.aimInsidePost

  // Lateral (sim x) component of the input picks the corner on that side of the goal.
  const lateralInput = len(dir) > 0.2 ? normalize(dir).x : 0
  let aimX: number
  if (Math.abs(lateralInput) > 0.3) {
    aimX = Math.sign(lateralInput) * inner
  } else {
    const kx = keeper ? keeper.pos.x : 0
    aimX = kx > shooter.pos.x * 0.15 ? -inner : inner
  }

  const p = clamp(power, 0, 1)
  const speed = lerp(SHOT.minSpeed, attr(a.shotPower, SHOT.maxSpeed - 5, SHOT.maxSpeed), p)
  const d = dist(shooter.pos, { x: aimX, y: goalY })
  const pressure = pressureOn(state, shooter)

  // Accuracy model (metres of aim error at the goal).
  const skill = attr((a.finishing + a.shotAccuracy) / 2, 1.0, 0.18)
  const sigma =
    skill * (0.35 + d / 14) * (0.7 + p * 0.6) * (0.8 + pressure * 0.7) * attr(a.composure, 1.2, 0.85)
  const errX = rng.gaussian() * sigma
  const aimZBase = lerp(0.35, 1.1, p)
  const errZ = rng.gaussian() * sigma * 0.45
  const aim = { x: aimX + errX, y: goalY }
  const aimZ = clamp(aimZBase + errZ, BALL.radius, 2.6)

  const dirV = normalize({ x: aim.x - shooter.pos.x, y: aim.y - shooter.pos.y })
  const flight = d / (speed * 0.93)
  // vz so the ball is at aimZ when it reaches the goal (ignoring drag, floor launch).
  const vz = clamp((aimZ - BALL.radius + 0.5 * BALL.gravity * flight * flight) / flight, 0, 9)
  const spin = rng.gaussian() * 0.4 * (1 - p * 0.5)
  return { velocity: { x: dirV.x * speed, y: dirV.y * speed }, vz, spin, speed, aim, aimZ }
}
