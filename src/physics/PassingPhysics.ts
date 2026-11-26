import { attr, clamp, lerp } from '../core/math/scalar'
import type { SeededRandom } from '../core/random/SeededRandom'
import {
  addScaled,
  closestOnSegment,
  dist,
  dot,
  fromAngle,
  len,
  normalize,
  sub,
  angleOf,
  type Vec2,
} from '../core/math/vec2'
import type { MatchState, PlayerState } from '../simulation/MatchState'
import { BALL, COURT, PASS } from '../simulation/SimulationConfig'
import type { PassAssistMode } from '../simulation/ControlOptions'
import { rollingLaunchSpeed, rollingTravelTime } from './BallPhysics'

export interface PassPlan {
  receiverId: number | null
  target: Vec2
  velocity: Vec2
  speed: number
}

/** Minimum distance from any opponent to the pass segment, adjusted for how early they could get there. */
export function laneOpenness(state: MatchState, team: number, from: Vec2, to: Vec2): number {
  let best = Infinity
  for (const o of state.players) {
    if (o.team === team) continue
    const { point, t } = closestOnSegment(from, to, o.pos)
    // Opponents near the end of a long pass have more time to close the gap.
    const d = dist(point, o.pos) - t * 0.6
    if (d < best) best = d
  }
  return best
}

/**
 * Assisted receiver selection: teammates inside a cone around the input direction, scored by angle,
 * distance and lane openness. Returns null if nobody is in the cone (pass goes into space).
 */
export function chooseReceiver(
  state: MatchState,
  passer: PlayerState,
  dir: Vec2,
  coneCos: number = PASS.assistConeCos,
  power?: number,
): PlayerState | null {
  const aim = len(dir) > 0.2 ? normalize(dir) : fromAngle(passer.facing)
  let best: PlayerState | null = null
  let bestScore = -Infinity
  for (const t of state.players) {
    if (t.team !== passer.team || t.id === passer.id) continue
    if (t.id === state.ball.keeperRetouchId) continue
    const to = sub(t.pos, passer.pos)
    const d = len(to)
    if (d < 1.5 || d > 30) continue
    const cos = dot(normalize(to), aim)
    if (cos < coneCos) continue
    const open = clamp(laneOpenness(state, passer.team, passer.pos, t.pos), 0, 3)
    const keeperPenalty = t.role === 'GK' ? 0.6 : 0
    // An opponent on the line (blocked lane) makes a teammate a poor choice even if he is nearest the
    // input: the assist prefers an open teammate in the same direction.
    const blocked = open < 0.5 ? -1.4 : 0
    // How long the button was held picks between two teammates in the same direction: a tap the
    // nearer one, a long press the one further away (no power given: the nearer one).
    const reachPref = power === undefined ? -d / 14 : ((power * 2 - 1) * d) / 9
    const score = cos * 3 + reachPref + open * 0.9 + blocked - keeperPenalty
    if (score > bestScore) {
      bestScore = score
      best = t
    }
  }
  return best
}

/** Distance a ground pass launched at `speed` rolls before it has slowed to about 2 m/s. */
export function rollingReach(speed: number): number {
  let v = speed
  let d = 0
  const h = 0.05
  for (let t = 0; t < 10 && v > 2; t += h) {
    v = Math.max(0, v - (BALL.rollingDecel + BALL.rollingDrag * v) * h)
    d += v * h
  }
  return d
}

/**
 * Manual passing: the teammate who can best meet a ball played along `aim` — within 2.5 m of the
 * line, ahead of the passer and not far beyond where it slows down.
 */
export function receiverOnLine(
  state: MatchState,
  passer: PlayerState,
  aim: Vec2,
  reach: number,
): PlayerState | null {
  let best: PlayerState | null = null
  let bestOff = 2.5
  for (const t of state.players) {
    if (t.team !== passer.team || t.id === passer.id || t.id === state.ball.keeperRetouchId) continue
    const to = sub(t.pos, passer.pos)
    const along = dot(to, aim)
    if (along < 1.5 || along > reach + 4) continue
    const off = Math.abs(to.x * aim.y - to.y * aim.x)
    if (off < bestOff) {
      bestOff = off
      best = t
    }
  }
  return best
}

/**
 * Predict where the receiver should meet the ball: iterate ball travel time against the receiver's
 * current motion. Through passes target space ahead of the receiver in the attacking direction.
 */
export function predictPassTarget(
  passer: PlayerState,
  receiver: PlayerState,
  through: boolean,
  attackDir: number,
): Vec2 {
  const arrival = through ? PASS.throughArrivalSpeed : PASS.arrivalSpeed
  let target = receiver.pos
  if (through) target = { x: target.x, y: target.y + attackDir * PASS.throughLead }
  for (let i = 0; i < 4; i++) {
    const d = dist(passer.pos, target)
    const v0 = clamp(rollingLaunchSpeed(d, arrival), PASS.minSpeed, PASS.maxSpeed)
    const t = Math.min(2.5, rollingTravelTime(d, v0))
    // A ball to feet goes (nearly) to where he is: he turns to meet it, so only the first moment of
    // his run is led — at most a metre (a square ball must not go 20-30 degrees up the court in
    // front of him, towards an opponent). A through ball is played into his path.
    const tt = Number.isFinite(t) ? t : 1.5
    if (through) {
      const base = { x: receiver.pos.x, y: receiver.pos.y + attackDir * PASS.throughLead }
      target = addScaled(base, receiver.vel, tt * 0.5)
    } else {
      const off = { x: receiver.vel.x * tt * 0.25, y: receiver.vel.y * tt * 0.25 }
      const l = Math.hypot(off.x, off.y)
      const k = l > 1 ? 1 / l : 1
      target = { x: receiver.pos.x + off.x * k, y: receiver.pos.y + off.y * k }
    }
  }
  // Not right on the line: with the angle error a ball aimed at the touchline goes out.
  return clampToCourt(target, through ? 0.8 : 1.2)
}

/**
 * Launch velocity for a lofted ball (chip, lobbed throw) from the floor that peaks at `apex` metres
 * and first lands `landFraction` of the way to `to` (it bounces and rolls on from there). Air drag is
 * allowed for roughly.
 */
export function lobVelocity(
  from: Vec2,
  to: Vec2,
  apex: number,
  landFraction = 0.85,
  launchHeight = 0,
): { x: number; y: number; vz: number } {
  const d = dist(from, to) * landFraction
  const vz = Math.sqrt(2 * BALL.gravity * Math.max(0.2, apex - launchHeight))
  // Time up to the apex and down from it to the floor.
  const t = vz / BALL.gravity + Math.sqrt((2 * apex) / BALL.gravity)
  const vh = (d / t) * (1 + BALL.airDrag * (d / t) * 0.6)
  const n =
    d > 1e-3 ? { x: (to.x - from.x) / dist(from, to), y: (to.y - from.y) / dist(from, to) } : { x: 0, y: 1 }
  return { x: n.x * vh, y: n.y * vh, vz }
}

export function clampToCourt(p: Vec2, margin: number): Vec2 {
  return {
    x: clamp(p.x, -COURT.halfWidth + margin, COURT.halfWidth - margin),
    y: clamp(p.y, -COURT.halfLength + margin, COURT.halfLength - margin),
  }
}

/** Pressure on a player: 0 (free) .. 1 (opponent touching). */
export function pressureOn(state: MatchState, p: PlayerState): number {
  let nearest = Infinity
  for (const o of state.players) {
    if (o.team === p.team) continue
    nearest = Math.min(nearest, dist(o.pos, p.pos))
  }
  return clamp(1 - (nearest - 0.6) / 2.4, 0, 1)
}

/** Build a pass: receiver, target, launch velocity with attribute- and pressure-based angular error. */
export function planPass(
  state: MatchState,
  passer: PlayerState,
  dir: Vec2,
  through: boolean,
  rng: SeededRandom,
  forcedReceiver: PlayerState | null = null,
  assist: PassAssistMode = 'assisted',
  power?: number,
  arrivalSpeed?: number,
): PassPlan {
  const attackDir = state.teams[passer.team].attackDir
  const a = passer.profile.attributes
  const pressure = pressureOn(state, passer)
  if (assist === 'manual' && !forcedReceiver) {
    // Manual: exactly along the input, power from the button hold. The teammate nearest the line
    // ahead is flagged as the receiver (he moves to meet it and control follows the ball).
    const aim = len(dir) > 0.2 ? normalize(dir) : fromAngle(passer.facing)
    const speed = lerp(PASS.minSpeed, PASS.maxSpeed, clamp(power ?? PASS.manualDefaultPower, 0, 1))
    const sigma = PASS.maxAngleErrorRad * attr(a.passing, 1, 0.15) * (0.6 + pressure) * 0.8
    const velocity = fromAngle(angleOf(aim) + rng.gaussian() * sigma, speed)
    const reach = rollingReach(speed)
    const receiver = receiverOnLine(state, passer, aim, reach)
    const target = addScaled(passer.pos, aim, reach)
    return { receiverId: receiver ? receiver.id : null, target, velocity, speed }
  }
  const coneCos = assist === 'semi' ? PASS.semiAssistConeCos : PASS.assistConeCos
  const receiver = forcedReceiver ?? chooseReceiver(state, passer, dir, coneCos, power)
  let target: Vec2
  // The human player's charged pass: the longer the press, the firmer it arrives (along the floor).
  const charged =
    power !== undefined
      ? lerp(PASS.humanArrivalSpeed, PASS.humanMaxArrivalSpeed, clamp(power, 0, 1))
      : undefined
  let arrival: number = arrivalSpeed ?? charged ?? (through ? PASS.throughArrivalSpeed : PASS.arrivalSpeed)
  if (receiver) {
    target = predictPassTarget(passer, receiver, through, attackDir)
  } else {
    // Into space along the input direction.
    const aim = len(dir) > 0.2 ? normalize(dir) : fromAngle(passer.facing)
    target = addScaled(passer.pos, aim, through ? 12 : 8)
    arrival = 2
  }
  const d = dist(passer.pos, target)
  const speed = clamp(rollingLaunchSpeed(d, arrival), PASS.minSpeed, PASS.maxSpeed)
  const skill = attr(a.passing, 1, 0.15)
  const sigma =
    PASS.maxAngleErrorRad * skill * (0.6 + pressure) * (through ? 1.3 : 1) * (assist === 'semi' ? 1.3 : 1)
  // Aimed from where the ball is (in front of his feet), so it goes straight to the receiver.
  const from = state.ball.ownerId === passer.id ? state.ball.pos : passer.pos
  const angle = angleOf(sub(target, from)) + rng.gaussian() * sigma
  const velocity = fromAngle(angle, speed)
  return { receiverId: receiver ? receiver.id : null, target, velocity, speed }
}
