/** Pass selection and interception: safe, progressive and direct passes; reading passes. */
import { attr, clamp } from '../core/math/scalar'
import type { SeededRandom } from '../core/random/SeededRandom'
import { addScaled, dist, len, normalize, sub, type Vec2 } from '../core/math/vec2'
import { estimateTimeToReach } from '../physics/PlayerPhysics'
import { laneOpenness, pressureOn } from '../physics/PassingPhysics'
import { rollingLaunchSpeed } from '../physics/BallPhysics'
import type { MatchState, PlayerState, TeamId } from '../simulation/MatchState'
import { BALL, COURT, PASS } from '../simulation/SimulationConfig'
import { difficultyFor, scoringValue, spaceAhead } from './common'

/** Earliest point on the ball's path the player can reach (sampled prediction). */
/**
 * Where to meet a moving ball: the first point on its path (from the ball towards him) that he can
 * get a foot to in time. A foot reaches about half a metre, so for a ball played to him he steps
 * towards it (or stays) instead of running back along its path to where it would hit his body —
 * which made receivers back-pedal before taking the ball.
 */
export function interceptPoint(state: MatchState, p: PlayerState): Vec2 {
  const ball = state.ball
  let pos = ball.pos
  let vel = ball.vel
  const h = 0.05
  const reach = 0.55
  for (let t = 0; t < 2.5; t += h) {
    const gap = dist(p.pos, pos)
    if (gap <= reach) return p.pos
    const at = addScaled(pos, normalize(sub(p.pos, pos)), reach)
    if (estimateTimeToReach(p, at) <= t) return at
    const s = len(vel)
    if (s < 0.05) break
    const ns = Math.max(0, s - (BALL.rollingDecel + BALL.rollingDrag * s) * h)
    vel = { x: (vel.x / s) * ns, y: (vel.y / s) * ns }
    pos = addScaled(pos, vel, h)
  }
  return pos
}

/**
 * A receiver's target for a pass coming to him: the meeting point — and once he is there with the
 * ball still on its way, a step on towards it (he attacks the ball rather than standing and waiting
 * for it, which also keeps an opponent from nipping in front of him).
 */
export function receivePoint(state: MatchState, p: PlayerState): Vec2 {
  // A chip in the air: go to where it comes down.
  const ball = state.ball
  if (ball.landing && ball.z > 0.3) return ball.landing
  const meet = interceptPoint(state, p)
  const toBall = sub(state.ball.pos, p.pos)
  if (dist(meet, p.pos) < 0.6 && len(toBall) > 1.6) return addScaled(p.pos, normalize(toBall), 1)
  return meet
}

/**
 * Interception of an opponent's ground pass in flight: the earliest point on the ball's path that
 * this player reaches first (with an anticipation-based read delay), before the receiver gets it.
 */
export function passInterception(state: MatchState, p: PlayerState): Vec2 | null {
  const ball = state.ball
  if (ball.mode !== 'free' || ball.intendedReceiverId === null || ball.lastTouchTeam === p.team) return null
  if (ball.z > 1.1 || len(ball.vel) < 4) return null
  const receiver = state.players[ball.intendedReceiverId]!
  if (receiver.team === p.team) return null
  const toReceiver = dist(ball.pos, receiver.pos)
  const read = Math.max(
    0,
    attr(p.profile.attributes.anticipation, 0.3, 0.08) + difficultyFor(state, p.team).readDelay,
  )
  let pos = ball.pos
  let vel = ball.vel
  let travelled = 0
  const h = 0.05
  for (let t = h; t < 2; t += h) {
    const s = len(vel)
    if (s < 0.5) break
    const ns = Math.max(0, s - 1.8 * h)
    vel = { x: (vel.x / s) * ns, y: (vel.y / s) * ns }
    pos = addScaled(pos, vel, h)
    travelled += ns * h
    if (travelled > toReceiver - 0.8) break
    // He only has to get a foot to it: reach the ball's path within about 0.6 m.
    const gap = dist(p.pos, pos)
    const reachAt = gap > 0.6 ? addScaled(pos, normalize(sub(p.pos, pos)), 0.6) : p.pos
    // Only with a clear margin: a failed attempt leaves his man free and the defence a man short.
    // Only with a margin: a failed attempt leaves his man free and the defence a man short.
    if (estimateTimeToReach(p, reachAt) + read + 0.1 <= t) return pos
  }
  return null
}

/** Progressive pass: an outfield teammate clearly ahead with an open lane and space (no keeper). */
export function progressivePass(state: MatchState, p: PlayerState): PlayerState | null {
  const dir = state.teams[p.team].attackDir
  let best: PlayerState | null = null
  let bestScore = 0
  for (const t of state.players) {
    if (t.team !== p.team || t.id === p.id || t.role === 'GK') continue
    const progress = (t.pos.y - p.pos.y) * dir
    if (progress < 2.5) continue
    const d = dist(t.pos, p.pos)
    if (d > 18) continue
    const lane = laneOpenness(state, p.team, p.pos, t.pos)
    if (lane < 0.9) continue
    let space = Infinity
    for (const o of state.players) if (o.team !== p.team) space = Math.min(space, dist(o.pos, t.pos))
    if (space < 1.6) continue
    if (passInterceptable(state, p.team, p.pos, t.pos, FORWARD_PASS_READ)) continue
    const score =
      progress * 0.12 +
      scoringValue(state, p.team, t.pos) * 1.5 +
      Math.min(lane, 3) * 0.3 +
      Math.min(space, 4) * 0.2
    if (score > bestScore) {
      bestScore = score
      best = t
    }
  }
  return best
}

/**
 * The vertical ball into the pivot (our most advanced player): played into his feet even with a
 * marker tight behind him — the marker cannot get to a ball played in front of the pivot, who holds it
 * up for a lay-off or turns. Needs an open lane and nobody able to step in front of him.
 */
export function pivotPass(state: MatchState, p: PlayerState): PlayerState | null {
  const dir = state.teams[p.team].attackDir
  let pivot: PlayerState | null = null
  for (const t of state.players) {
    if (t.team !== p.team || t.role === 'GK') continue
    if (!pivot || (t.pos.y - pivot.pos.y) * dir > 0) pivot = t
  }
  if (!pivot || pivot.id === p.id) return null
  const progress = (pivot.pos.y - p.pos.y) * dir
  const d = dist(pivot.pos, p.pos)
  if (progress < 4 || d > 20) return null
  // Not when he is already in front of goal (a shot or the direct ball is the job then).
  if ((dir * COURT.halfLength - pivot.pos.y) * dir < 5) return null
  const along = normalize(sub(pivot.pos, p.pos))
  // A marker behind him (further along the pass line, close to him) does not cut it out.
  const behind = (o: PlayerState) => {
    const rel = sub(o.pos, pivot!.pos)
    const ahead = rel.x * along.x + rel.y * along.y
    const lat = Math.abs(rel.x * -along.y + rel.y * along.x)
    return ahead > -0.2 && ahead < 2.2 && lat < 1.4
  }
  let lane = Infinity
  for (const o of state.players) {
    if (o.team === p.team || behind(o)) continue
    const rel = sub(o.pos, p.pos)
    const t = rel.x * along.x + rel.y * along.y
    if (t < 0.5 || t > d) continue
    lane = Math.min(lane, Math.abs(rel.x * -along.y + rel.y * along.x))
  }
  if (lane < 1.1) return null
  if (passInterceptable(state, p.team, p.pos, pivot.pos, FORWARD_PASS_READ, behind)) return null
  return pivot
}

/**
 * A forward pass to a teammate who is free in a scoring position: the lane is open, the receiver has
 * space, is clearly ahead of the ball and more dangerous than the carrier. Runners moving forward with
 * space behind the defence get a through pass.
 */
export function forwardChance(
  state: MatchState,
  p: PlayerState,
): { player: PlayerState; through: boolean } | null {
  const dir = state.teams[p.team].attackDir
  const own = scoringValue(state, p.team, p.pos)
  let best: PlayerState | null = null
  let bestScore = 0
  let bestThrough = false
  for (const t of state.players) {
    if (t.team !== p.team || t.id === p.id || t.role === 'GK') continue
    const progress = (t.pos.y - p.pos.y) * dir
    if (progress < 1.5) continue
    const d = dist(t.pos, p.pos)
    if (d > 20) continue
    const lane = laneOpenness(state, p.team, p.pos, t.pos)
    if (lane < 0.8) continue
    let space = Infinity
    for (const o of state.players)
      if (o.team !== p.team && o.role !== 'GK') space = Math.min(space, dist(o.pos, t.pos))
    if (space < 1.2) continue
    const danger = scoringValue(state, p.team, t.pos)
    if (danger < 0.2 || danger < own + 0.05) continue
    if (passInterceptable(state, p.team, p.pos, t.pos, FORWARD_PASS_READ)) continue
    const score = danger * 2 + Math.min(lane, 3) * 0.3 + Math.min(space, 4) * 0.2
    if (score > bestScore) {
      bestScore = score
      best = t
      const runningForward = t.vel.y * dir > 1.5
      bestThrough = runningForward && spaceAhead(state, t, { x: 0, y: dir }, 3)
    }
  }
  return best ? { player: best, through: bestThrough } : null
}

/**
 * Can an opponent cut out a ground pass from `from` to `to`? The ball is followed along its path (same
 * launch speed as a normal pass); an opponent intercepts if he can get a foot to a point on the path
 * (within 0.6 m) before the ball is there, allowing a short read delay. Keepers count only inside
 * their own penalty area. Used so the AI does not play loose balls through the middle.
 */
export function passInterceptable(
  state: MatchState,
  team: TeamId,
  from: Vec2,
  to: Vec2,
  read = 0.12,
  ignore?: (o: PlayerState) => boolean,
): boolean {
  const d = dist(from, to)
  if (d < 1) return false
  const speed = clamp(rollingLaunchSpeed(d, PASS.arrivalSpeed), PASS.minSpeed, PASS.maxSpeed)
  const dirV = normalize(sub(to, from))
  let v = speed
  let travelled = 0
  const h = 0.05
  for (let t = h; travelled < d - 0.6; t += h) {
    v = Math.max(0.5, v - (1.6 + 0.12 * v) * h)
    travelled += v * h
    const pt = addScaled(from, dirV, Math.min(travelled, d))
    for (const o of state.players) {
      if (o.team === team || ignore?.(o)) continue
      if (o.role === 'GK' && dist(o.pos, { x: 0, y: -state.teams[o.team].attackDir * COURT.halfLength }) > 7)
        continue
      const gap = dist(o.pos, pt)
      if (gap > v * 2 + 6) continue
      // The human-controlled player reacts at once and turns and accelerates faster: give him a longer
      // reach and no read delay (otherwise the AI keeps passing straight to him).
      const human = o.id === state.controlledId
      const reach = human ? HUMAN_READ.reach : 0.6
      const reachAt = gap > reach ? addScaled(pt, normalize(sub(o.pos, pt)), reach) : o.pos
      const time = human
        ? estimateTimeToReach(o, reachAt) * HUMAN_READ.speedFactor + Math.min(read, HUMAN_READ.read)
        : estimateTimeToReach(o, reachAt) + read
      if (time <= t) return true
    }
    if (t > 3) break
  }
  return false
}

/** A teammate near the touch line running hard towards it: a ball to him is likely to go out. */
function runningOut(t: PlayerState): boolean {
  const near = COURT.halfWidth - Math.abs(t.pos.x) < 2.2
  return near && t.vel.x * Math.sign(t.pos.x) > 2.5
}

/** How the AI rates the human-controlled player when judging whether he can cut a pass out. */
export const HUMAN_READ = { reach: 1.1, speedFactor: 0.72, read: 0 } as const

/**
 * Forward passes into danger are allowed a little more risk than circulation passes: the opponent's
 * read delay assumed for them is longer.
 */
export const FORWARD_PASS_READ = 0.3

/** Circulation pass: the most open nearby teammate (sideways or back), keeper only under real pressure. */
export function safePassOption(
  state: MatchState,
  p: PlayerState,
  pressure: number,
  rng: SeededRandom,
): PlayerState | null {
  const dir = state.teams[p.team].attackDir
  let best: PlayerState | null = null
  let bestScore = -Infinity
  for (const t of state.players) {
    if (t.team !== p.team || t.id === p.id) continue
    // The keeper: a back pass when it is allowed (he has not just released it in his half) and the
    // carrier is in his own half under some pressure, or anywhere under heavy pressure.
    const ownHalf = p.pos.y * dir < 0
    if (t.role === 'GK' && (pressure < (ownHalf ? 0.4 : 0.7) || t.id === state.ball.keeperRetouchId)) continue
    const d = dist(t.pos, p.pos)
    if (d < 2.5 || d > 16) continue
    const lane = laneOpenness(state, p.team, p.pos, t.pos)
    if (lane < 0.9) continue
    let space = Infinity
    for (const o of state.players) if (o.team !== p.team) space = Math.min(space, dist(o.pos, t.pos))
    if (space < 1.5) continue
    if (passInterceptable(state, p.team, p.pos, t.pos)) continue
    if (runningOut(t)) continue
    const progress = ((t.pos.y - p.pos.y) * dir) / 10
    const score =
      Math.min(lane, 3) +
      Math.min(space, 4) * 0.4 +
      progress * 0.4 -
      Math.abs(d - 8) * 0.05 +
      rng.range(-0.1, 0.1)
    if (score > bestScore) {
      bestScore = score
      best = t
    }
  }
  return best
}

/** Score teammates as pass targets: lane openness, forward progress, receiver space; keeper only under pressure. */
export function bestPassOption(
  state: MatchState,
  p: PlayerState,
  rng: SeededRandom,
): { player: PlayerState; score: number } | null {
  const dir = state.teams[p.team].attackDir
  const pressure = pressureOn(state, p)
  let best: PlayerState | null = null
  let bestScore = -Infinity
  for (const t of state.players) {
    if (t.team !== p.team || t.id === p.id) continue
    if (t.id === state.ball.keeperRetouchId) continue
    const d = dist(t.pos, p.pos)
    if (d < 2 || d > 22) continue
    const open = clamp(laneOpenness(state, p.team, p.pos, t.pos), -1, 3)
    let space = Infinity
    for (const o of state.players) if (o.team !== p.team) space = Math.min(space, dist(o.pos, t.pos))
    const progress = ((t.pos.y - p.pos.y) * dir) / 10
    const keeper = t.role === 'GK' ? -1.2 + pressure : 0
    // A tightly marked receiver is a bad option even with an open lane.
    const marked = space < 1.3 ? -1.5 : 0
    // A pass an opponent can cut out is a last resort; so is one to a man running out of the court.
    const risky = passInterceptable(state, p.team, p.pos, t.pos) ? -2.5 : runningOut(t) ? -1.5 : 0
    const score =
      open * 0.9 +
      progress * 1.1 +
      Math.min(space, 4) * 0.3 +
      keeper +
      marked +
      risky +
      rng.range(-0.15, 0.15)
    if (score > bestScore) {
      bestScore = score
      best = t
    }
  }
  return best ? { player: best, score: bestScore } : null
}
