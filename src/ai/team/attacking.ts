/** Team attacking movement: support positions, runs in behind, back post, set-piece routine. */
import { clamp } from '../../core/math/scalar'
import { addScaled, closestOnSegment, dist, len, normalize, sub, type Vec2 } from '../../core/math/vec2'
import { laneOpenness, predictPassTarget, pressureOn } from '../../physics/PassingPhysics'
import type { MatchState, PlayerState, TeamId } from '../../simulation/MatchState'
import { COURT } from '../../simulation/SimulationConfig'
import { deepestOutfield } from '../common'
import { passInterceptable, FORWARD_PASS_READ } from '../passing'
import { controlAt } from '../spatial/PitchControl'

export type RoutineRole = 'short' | 'pivot' | 'deep'

/**
 * Attacking kick-in (in the attacking half) or corner: the standard routine with movement so the
 * taker has options. The short man starts a few metres off and comes towards the ball (behind it, so
 * he can shoot first time), the pivot starts at the back post and comes out to the front of the area,
 * and the deep man leaves the halfway line to show for a pass back. Roles are fixed once per restart;
 * spots move with the time since the taker got ready.
 */
export function setPieceRoutine(
  state: MatchState,
  team: TeamId,
): { id: number; spot: Vec2; role: RoutineRole }[] | null {
  const r = state.restart
  if (!r || r.team !== team || (r.type !== 'kickIn' && r.type !== 'corner')) return null
  const dir = state.teams[team].attackDir
  if (r.type === 'kickIn' && r.spot.y * dir < 2) return null
  const goalY = dir * COURT.halfLength
  const side = Math.sign(r.spot.x) || 1
  const inward = { x: -side, y: 0 }
  const back = { x: 0, y: -dir }
  const inCourt = (v: Vec2) => ({ x: clamp(v.x, -9.2, 9.2), y: clamp(v.y, -18.8, 18.8) })
  const at = (a: number, b: number) =>
    inCourt({ x: r.spot.x + inward.x * a + back.x * b, y: r.spot.y + inward.y * a + back.y * b })
  const start = [at(5.5, 4.5), { x: -side * 1.6, y: goalY - dir * 1.3 }, { x: side * -1.5, y: -dir * 1 }]
  const roles: RoutineRole[] = ['short', 'pivot', 'deep']
  if (!r.routineIds) {
    const free = state.players.filter((p) => p.team === team && p.role !== 'GK' && p.id !== r.takerId)
    const ids: number[] = []
    for (const spot of start) {
      if (!free.length) break
      let bi = 0
      for (let k = 1; k < free.length; k++) if (dist(free[k]!.pos, spot) < dist(free[bi]!.pos, spot)) bi = k
      ids.push(free[bi]!.id)
      free.splice(bi, 1)
    }
    r.routineIds = ids
  }
  const t = r.ready ? r.readyTimer : 0
  const moved = [
    t > 0.5 ? at(2.6, 1.8) : start[0]!,
    t > 0.9 ? { x: side * 1.0, y: goalY - dir * 5.5 } : start[1]!,
    t > 1.3 ? at(3.5, 7) : start[2]!,
  ]
  return r.routineIds.map((id, k) => ({ id, spot: moved[k]!, role: roles[k]! }))
}

/**
 * Run in behind ("nousee pystyyn"): a teammate has the ball (typically the pivot holding it up) and
 * the wing ahead of this player is empty, so he sprints forward down that wing into the space behind
 * the defence, offering a through ball. Never the carrier, the keeper or the deepest player (cover).
 */
export function runInBehind(state: MatchState, p: PlayerState): Vec2 | null {
  const owner = state.ball.ownerId !== null ? state.players[state.ball.ownerId]! : null
  if (!owner || owner.team !== p.team || owner.id === p.id || owner.role === 'GK' || state.ball.inHands)
    return null
  if (p.role === 'GK' || p.aiRunCooldown > 0 || deepestOutfield(state, p.team) === p.id) return null
  const dir = state.teams[p.team].attackDir
  const goalY = dir * COURT.halfLength
  const toGoal = (goalY - p.pos.y) * dir
  if (toGoal < 9 || toGoal > 30) return null
  // The carrier must be holding the ball up with time to play it (not under heavy pressure), and only
  // one player of the team runs at a time.
  // Counter-attack window (just won the ball): go at once, with less cover behind the ball.
  const counter = state.teamPhase[p.team] === 'transitionAttack'
  if (pressureOn(state, owner) > 0.6 || (!counter && owner.aiHoldTimer < 0.4)) return null
  if (state.players.some((t) => t.team === p.team && t.id !== p.id && t.aiRunTimer > 0)) return null
  // Balance: two teammates must stay behind the ball (cover against the counter-attack).
  const dirB = state.teams[p.team].attackDir
  const behindBall = state.players.filter(
    (t) =>
      t.team === p.team &&
      t.role !== 'GK' &&
      t.id !== p.id &&
      t.id !== owner.id &&
      (t.pos.y - owner.pos.y) * dirB < 0,
  ).length
  if (behindBall < (counter ? 1 : 2)) return null
  const side = Math.abs(p.pos.x) > 1 ? Math.sign(p.pos.x) : Math.sign(p.pos.x - owner.pos.x) || 1
  const target = {
    x: side * clamp(Math.abs(p.pos.x) + 1, 5.5, 8),
    y: goalY - dir * Math.max(4.5, toGoal - 13),
  }
  // The lane must be empty: no outfield defender within 2.5 m of the run (ahead of him).
  for (const o of state.players) {
    if (o.team === p.team || o.role === 'GK') continue
    if ((o.pos.y - p.pos.y) * dir < -0.5) continue
    const { point } = closestOnSegment(p.pos, target, o.pos)
    if (dist(point, o.pos) < 2.5) return null
  }
  // Only when it actually goes forward from where the ball is (a run beyond the carrier's line).
  if ((target.y - owner.pos.y) * dir < 2) return null
  return target
}

/** A teammate on a run in behind whose path the carrier can find with a through ball. */
export function runnerOption(state: MatchState, carrier: PlayerState): PlayerState | null {
  const dir = state.teams[carrier.team].attackDir
  let best: PlayerState | null = null
  for (const t of state.players) {
    if (t.team !== carrier.team || t.id === carrier.id || t.aiState !== 'run' || t.aiRunTimer <= 0) continue
    if ((t.pos.y - carrier.pos.y) * dir < -1) continue
    if ((t.pos.y - carrier.pos.y) * dir < 2) continue
    const lead = predictPassTarget(carrier, t, true, dir)
    if (laneOpenness(state, carrier.team, carrier.pos, lead) < 1.1) continue
    if (dist(lead, carrier.pos) > 18) continue
    // Real space at the end of the run: no defender within 2.5 m of where the ball is played.
    let space = Infinity
    for (const o of state.players)
      if (o.team !== carrier.team && o.role !== 'GK') space = Math.min(space, dist(o.pos, lead))
    if (space < 2.5) continue
    if (passInterceptable(state, carrier.team, carrier.pos, lead, FORWARD_PASS_READ)) continue
    if (!best || t.aiRunTimer > best.aiRunTimer) best = t
  }
  return best
}

/**
 * Follow-up: when a teammate shoots, the attacker best placed for it (not the shooter, not the
 * deepest player) attacks the back post for a rebound or a tap-in.
 */
export function followUpTarget(state: MatchState, p: PlayerState): Vec2 | null {
  const b = state.ball
  if (!b.isShot || b.mode !== 'free' || b.lastTouchTeam !== p.team || b.lastTouchId === p.id) return null
  if (p.role === 'GK' || deepestOutfield(state, p.team) === p.id) return null
  const dir = state.teams[p.team].attackDir
  const goalY = dir * COURT.halfLength
  if (b.vel.y * dir <= 0) return null
  // Far post relative to the shot's line.
  const crossX = b.pos.x + (b.vel.x * (goalY - b.pos.y)) / (b.vel.y || 1e-6)
  const farSide = crossX >= 0 ? -1 : 1
  const spot = { x: farSide * 1.8, y: goalY - dir * 1.4 }
  // Only the nearest suitable attacker goes (one man on the rebound).
  let best: PlayerState | null = null
  for (const t of state.players) {
    if (
      t.team !== p.team ||
      t.role === 'GK' ||
      t.id === b.lastTouchId ||
      deepestOutfield(state, p.team) === t.id
    )
      continue
    if (!best || dist(t.pos, spot) < dist(best.pos, spot)) best = t
  }
  return best && best.id === p.id && dist(p.pos, spot) < 16 ? spot : null
}

/**
 * Ball on a wing near goal: the attacker best placed (not the carrier, not the deepest) takes the
 * back post, ready for a cross or a shot that comes across goal.
 */
export function backPostSpot(state: MatchState, p: PlayerState): Vec2 | null {
  const owner = state.ball.ownerId !== null ? state.players[state.ball.ownerId]! : null
  if (!owner || owner.team !== p.team || owner.id === p.id || p.role === 'GK') return null
  const dir = state.teams[p.team].attackDir
  const goalY = dir * COURT.halfLength
  if (Math.abs(owner.pos.x) < 3.5 || (goalY - owner.pos.y) * dir > 13) return null
  const spot = { x: -Math.sign(owner.pos.x) * 1.9, y: goalY - dir * 2.2 }
  let best: PlayerState | null = null
  for (const t of state.players) {
    if (t.team !== p.team || t.role === 'GK' || t.id === owner.id || deepestOutfield(state, p.team) === t.id)
      continue
    if (!best || dist(t.pos, spot) < dist(best.pos, spot)) best = t
  }
  return best && best.id === p.id ? spot : null
}

/**
 * The pivot does not stay in the middle: every few seconds he moves between the middle, the ball-side
 * wing and the far post/wing to find space (deterministic rhythm per team and half).
 */
export function pivotAnchor(state: MatchState, p: PlayerState, anchor: Vec2): Vec2 {
  const dir = state.teams[p.team].attackDir
  const phase = Math.floor((state.tick + p.team * 157) / (60 * 4.5)) % 3
  const ballSide = Math.sign(state.ball.pos.x) || 1
  if (phase === 0) return anchor
  const x = phase === 1 ? ballSide * 6.2 : -ballSide * 4.5
  // On the wing a little deeper towards the goal line.
  const y = clamp(anchor.y + dir * 1.5, -COURT.halfLength + 3, COURT.halfLength - 3)
  return { x, y }
}

/** Move off the anchor towards a spot with an open passing lane to the ball. */
export function supportPosition(state: MatchState, p: PlayerState, anchor: Vec2): Vec2 {
  const ballPos = state.ball.pos
  const dir = state.teams[p.team].attackDir
  let best = anchor
  let bestScore = -Infinity
  // Candidates in rings round the shape position (up to 5 m) and a "show" spot towards the ball.
  const cands: Vec2[] = [anchor]
  for (const r of [1.6, 3.2, 5])
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4 + (r === 3.2 ? Math.PI / 8 : 0)
      cands.push({ x: anchor.x + Math.cos(a) * r, y: anchor.y + Math.sin(a) * r })
    }
  const toBall = sub(ballPos, p.pos)
  if (len(toBall) > 6) cands.push(addScaled(p.pos, normalize(toBall), Math.min(4, len(toBall) - 5)))
  for (const raw of cands) {
    const c = { x: clamp(raw.x, -9.3, 9.3), y: clamp(raw.y, -18.8, 18.8) }
    const lane = clamp(laneOpenness(state, p.team, ballPos, c), 0, 3)
    const d = dist(c, ballPos)
    // Passing distance: not on top of the carrier, not too far for a ground pass.
    const range = d < 3.5 ? -2 : d > 15 ? -(d - 15) * 0.35 : 0
    // Get free from the marker: distance to the nearest opponent counts.
    let free = Infinity
    for (const o of state.players)
      if (o.team !== p.team && o.role !== 'GK') free = Math.min(free, dist(o.pos, c))
    // Keep spacing from teammates (no two players offering the same option).
    let crowd = 0
    for (const t of state.players)
      if (t.team === p.team && t.id !== p.id && t.id !== state.ball.ownerId && dist(t.pos, c) < 3)
        crowd -= 0.8
    // Slight preference for forward options and for the spot he is already heading to (stability).
    const forward = ((c.y - ballPos.y) * dir) / 20
    const keep = dist(c, p.aiTarget) < 1 ? 0.3 : 0
    // Space our team owns (pitch control): a spot we reach first is a safer option.
    const owned = controlAt(state, p.team, c)
    const score =
      lane * 0.9 +
      Math.min(free, 4) * 0.8 +
      range +
      crowd +
      forward * 1.2 +
      keep +
      owned * 0.8 -
      dist(c, anchor) * 0.15
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  return best
}
