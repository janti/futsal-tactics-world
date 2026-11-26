/** Steering: walking to targets, detours round goals and opponents, arrival easing. */
import { attr, clamp } from '../core/math/scalar'
import { addScaled, closestOnSegment, dist, len, normalize, sub, type Vec2 } from '../core/math/vec2'
import { routeAroundGoals } from '../physics/PlayerPhysics'
import type { MatchState, PlayerState } from '../simulation/MatchState'
import { COURT } from '../simulation/SimulationConfig'
import { PRESS_ENGAGE_DISTANCE, outsideClearanceArea } from './common'

export function keepDistance(target: Vec2, from: Vec2, minDist: number): Vec2 {
  const d = dist(target, from)
  if (d >= minDist) return target
  const away = d > 1e-3 ? normalize(sub(target, from)) : { x: 0, y: 1 }
  return addScaled(from, away, minDist)
}

export function steer(state: MatchState, p: PlayerState): void {
  const owner = state.ball.ownerId !== null ? state.players[state.ball.ownerId]! : null
  const engage =
    owner !== null &&
    dist(owner.pos, { x: 0, y: -state.teams[p.team].attackDir * COURT.halfLength }) <= PRESS_ENGAGE_DISTANCE
  if (p.aiState === 'press' && owner && owner.team !== p.team && engage && dist(owner.pos, p.pos) < 2.2) {
    // Close to the carrier: track him every tick and step in on the ball (where it is going), so a
    // dribbler has to beat him rather than just walk round a static marker.
    // Stay goal-side: track a point between the ball and our goal, stepping onto the ball itself only
    // when right on it — a carrier driving at goal has to go through him, not past him.
    const ownGoal = { x: 0, y: -state.teams[p.team].attackDir * COURT.halfLength }
    const gap = dist(state.ball.pos, p.pos)
    const spot = addScaled(state.ball.pos, normalize(sub(ownGoal, state.ball.pos)), gap > 1.3 ? 0.8 : 0.15)
    const to = sub(spot, p.pos)
    // Jockey (a little slower than full pace) only while the carrier is nearly still; when he drives
    // on, keep pace with him (sprinting if he does or gets away), so he cannot just run past.
    const carrierSpeed = len(owner.vel)
    const k =
      carrierSpeed < 2.5
        ? attr((p.profile.attributes.tackling + p.profile.attributes.agility) / 2, 0.78, 0.98)
        : 1
    p.moveIntent = len(to) > 0.05 ? { x: normalize(to).x * k, y: normalize(to).y * k } : { x: 0, y: 0 }
    p.sprint = owner.sprint
    p.faceTarget = state.ball.pos
    return
  }
  const d = dist(p.aiTarget, p.pos)
  // In a counter-attack against us, and right after losing the ball, everybody sprints back to his man.
  const recovering = p.aiState === 'cover' && (state.defTransition[p.team] || p.aiRecoverTimer > 0) && d > 1.5
  // Getting free: a supporting player sprints into space when his spot is a few metres away.
  const showing = p.aiState === 'support' && d > 2.5
  const urgent =
    p.aiState === 'chase' ||
    p.aiState === 'intercept' ||
    p.aiState === 'run' ||
    (p.aiState === 'twoVone' && d > 1.2) ||
    // A marker left behind by his man (a run, a change of pace) sprints to get back to him.
    (p.aiState === 'cover' && d > 2) ||
    (p.aiState === 'press' && d > 2.5) ||
    d > 5 ||
    recovering ||
    showing
  // A marker whose spot is on the far side of an opponent goes round him (to get goal-side of his
  // man) instead of walking into his back.
  // Goal clearance: stay out of the clearing team's penalty area (a keeper stays in his own).
  const legal =
    state.clearance && !(p.role === 'GK' && p.team === state.clearance.team)
      ? outsideClearanceArea(state, p.aiTarget)
      : p.aiTarget
  const target = p.aiState === 'cover' || p.aiState === 'press' ? aroundBodies(state, p, legal) : legal
  walkTo(p, target, urgent)
  if (p.aiState === 'press' && d < 1.5) {
    p.moveIntent = { x: p.moveIntent.x * 0.6, y: p.moveIntent.y * 0.6 }
  }
  // Watch the ball while positioning or close to the play; on a longer run face where you are going
  // (no long sideways or backwards runs).
  if (p.aiState !== 'chase' && (d < 3 || dist(p.pos, state.ball.pos) < 4)) p.faceTarget = state.ball.pos
}

/** Detour point round the first opponent standing in the way to `target` (else `target`). */
function aroundBodies(state: MatchState, p: PlayerState, target: Vec2): Vec2 {
  const to = sub(target, p.pos)
  if (len(to) < 0.3) return target
  for (const o of state.players) {
    if (o.team === p.team || o.role === 'GK') continue
    if (dist(o.pos, p.pos) > 4) continue
    const { point, t } = closestOnSegment(p.pos, target, o.pos)
    if (t <= 0.02 || t >= 0.98 || dist(point, o.pos) > 0.75) continue
    // Pass on the side that makes the shorter way round (stable from tick to tick).
    const n = normalize(to)
    const left = addScaled(o.pos, { x: -n.y, y: n.x }, 1.0)
    const right = addScaled(o.pos, { x: n.y, y: -n.x }, 1.0)
    const via = (w: Vec2) => dist(p.pos, w) + dist(w, target)
    return via(left) <= via(right) ? left : right
  }
  return target
}

/** Arrival steering: full intent far away, easing in within 1.5 m, idle inside 0.15 m. */
export function walkTo(p: PlayerState, target: Vec2, sprint: boolean): void {
  // Never try to walk through a goal: head for the detour point first.
  const waypoint = routeAroundGoals(p.pos, target)
  if (waypoint !== target) {
    p.moveIntent = normalize(sub(waypoint, p.pos))
    p.sprint = sprint
    return
  }
  const to = sub(target, p.pos)
  const d = len(to)
  if (d < 0.15) {
    p.moveIntent = { x: 0, y: 0 }
    p.sprint = false
    return
  }
  const mag = clamp(d / 1.5, 0, 1)
  const n = normalize(to)
  p.moveIntent = { x: n.x * mag, y: n.y * mag }
  p.sprint = sprint
}
