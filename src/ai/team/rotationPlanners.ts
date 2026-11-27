/**
 * Planners of the rotation library: for each coordinated kind, whether its trigger holds now and,
 * if so, the participants with their jobs and targets (a `Plan`). Planners do not start anything —
 * rotationSelect.ts scores every plan against keeping the shape and starts the best one. Targets are
 * intentions; players get there with the normal steering (curves, avoidance, turning).
 *
 * Planners never give a job to the human-controlled player (he may be the carrier the move is built
 * round). Every plan is written for the team's own attacking direction and the side of the ball, so
 * it mirrors left/right and works in both halves.
 */
import { clamp } from '../../core/math/scalar'
import { dist, type Vec2 } from '../../core/math/vec2'
import { laneOpenness, pressureOn } from '../../physics/PassingPhysics'
import { estimateTimeToReach } from '../../physics/PlayerPhysics'
import type { MatchState, PlayerState, TeamId } from '../../simulation/MatchState'
import { passInterceptable } from '../passing'
import type { RotationKind } from './rotationLibrary'
import type { RotationMove } from './rotationState'
import {
  attackDir,
  balanceOk,
  carrierOf,
  defenderInFront,
  deepestOf,
  depthToGoal,
  free,
  goalYOf,
  inCourt,
  isMiddle,
  isWing,
  markerOf,
  movable,
  outfield,
  pathFree,
  pivotOf,
  spaceAt,
} from './rotationSupport'

export interface Plan {
  kind: RotationKind
  carrierId: number
  moves: RotationMove[]
  trigger: string
}

/** Rotations happen between these distances (m) from the goal attacked (build-up and midcourt). */
export const ROTATION_ZONE = { near: 12, far: 36 } as const

const isMovable = (state: MatchState, p: PlayerState) => p.id !== state.controlledId && p.role !== 'GK'

/** Fastest outfield opponent to `pos` (seconds), optionally ignoring some. */
export function opponentEta(
  state: MatchState,
  team: TeamId,
  pos: Vec2,
  ignore: readonly number[] = [],
): number {
  let best = Infinity
  for (const o of state.players)
    if (o.team !== team && o.role !== 'GK' && !ignore.includes(o.id))
      best = Math.min(best, estimateTimeToReach(o, pos))
  return best
}

/**
 * The pass `team` has just played (the ball still near the passer): passer and receiver, both outfield
 * players, the receiver in the rotation zone. Null otherwise.
 */
export function justPassed(
  state: MatchState,
  team: TeamId,
): { passer: PlayerState; receiver: PlayerState } | null {
  const b = state.ball
  if (
    b.mode !== 'free' ||
    b.lastTouchTeam !== team ||
    b.intendedReceiverId === null ||
    b.lastTouchId === null
  )
    return null
  const passer = state.players[b.lastTouchId]!
  const receiver = state.players[b.intendedReceiverId]!
  if (passer.team !== team || receiver.team !== team || passer.role === 'GK' || receiver.role === 'GK')
    return null
  if (passer.id === receiver.id || dist(b.pos, passer.pos) > 6) return null
  const depth = depthToGoal(state, team, receiver.pos)
  if (depth < ROTATION_ZONE.near || depth > ROTATION_ZONE.far) return null
  return { passer, receiver }
}

/** The passer of a pattern runs: not the human player. */
function passTrigger(state: MatchState, team: TeamId) {
  const pass = justPassed(state, team)
  return pass && isMovable(state, pass.passer) ? pass : null
}

// =============================================================================== patterns

/** The far wing is free for a quick switch from the receiver. */
function switchOn(state: MatchState, team: TeamId, from: PlayerState, far: PlayerState): boolean {
  return spaceAt(state, team, far.pos) >= 2.5 && laneOpenness(state, team, from.pos, far.pos) > 1.2
}

/** Pohjakasi (3-1): the middle man of the back three passes to a wing. */
export function planBaseEight(state: MatchState, team: TeamId): Plan | null {
  if (state.teams[team].tactics.formation !== '3-1') return null
  const pass = passTrigger(state, team)
  if (!pass) return null
  const { passer, receiver } = pass
  const pivot = pivotOf(state, team)
  if (!pivot || passer.id === pivot.id || receiver.id === pivot.id) return null
  if (!isMiddle(passer) || !isWing(receiver)) return null
  const dir = attackDir(state, team)
  const goalY = goalYOf(state, team)
  const side = Math.sign(receiver.pos.x)
  // First up the middle, then out to the wing he passed to, ahead of the receiver.
  const via = inCourt({ x: passer.pos.x * 0.3 + side * 0.6, y: passer.pos.y + dir * 4 })
  // Deep: on past the receiver towards the area (the run must take a defender with it).
  const ahead = clamp((goalY - receiver.pos.y) * dir - 6, 3, 8)
  const target = inCourt({ x: side * 7.8, y: receiver.pos.y + dir * ahead })
  // The receiver carries it inside into the middle the passer left.
  const carry = inCourt({ x: side * 0.8, y: receiver.pos.y + dir * 1.5 })
  return {
    kind: 'baseEight',
    carrierId: receiver.id,
    trigger: 'middleToWing',
    moves: [
      { id: passer.id, job: 'run', target, via },
      { id: receiver.id, job: 'carry', target: carry },
    ],
  }
}

/** Pohjakasi from the wing (3-1): a wing passes into the middle and runs diagonally up. */
export function planBaseEightWing(state: MatchState, team: TeamId): Plan | null {
  if (state.teams[team].tactics.formation !== '3-1') return null
  const pass = passTrigger(state, team)
  if (!pass) return null
  const { passer, receiver } = pass
  const pivot = pivotOf(state, team)
  if (!pivot || passer.id === pivot.id || receiver.id === pivot.id) return null
  if (!isWing(passer) || !isMiddle(receiver)) return null
  const side = Math.sign(passer.pos.x)
  // The far wing: the third man of the base, on the other side.
  const far = outfield(state, team).find(
    (t) => t.id !== passer.id && t.id !== receiver.id && t.id !== pivot.id && t.pos.x * side < 0,
  )
  if (!far || !switchOn(state, team, receiver, far)) return null
  const dir = attackDir(state, team)
  const up = clamp(depthToGoal(state, team, passer.pos) - 6, 4, 10)
  const target = inCourt({ x: side * 1.2, y: passer.pos.y + dir * up })
  return {
    kind: 'baseEightWing',
    carrierId: receiver.id,
    trigger: 'wingToMiddle',
    moves: [
      { id: passer.id, job: 'run', target },
      // Switches it to the far wing at once, then moves across into the wing the runner left.
      { id: receiver.id, job: 'switch', target: { ...passer.pos }, passTo: far.id },
    ],
  }
}

/**
 * The 3-player circular rotation (3-1): a wing passes back into the middle and goes straight up his
 * wing (depth); the middle man carries it towards that wing and the far wing comes across into the
 * middle behind the ball. The pivot keeps the depth.
 */
export function planThreeCircle(state: MatchState, team: TeamId): Plan | null {
  if (state.teams[team].tactics.formation !== '3-1') return null
  const pass = passTrigger(state, team)
  if (!pass) return null
  const { passer, receiver } = pass
  const pivot = pivotOf(state, team)
  if (!pivot || passer.id === pivot.id || receiver.id === pivot.id) return null
  if (!isWing(passer) || !isMiddle(receiver)) return null
  const dir = attackDir(state, team)
  if ((receiver.pos.y - passer.pos.y) * dir > 0.5) return null // a pass back or square
  const side = Math.sign(passer.pos.x)
  const far = movable(state, team).find(
    (t) => t.id !== passer.id && t.id !== receiver.id && t.id !== pivot.id && t.pos.x * side < 0,
  )
  // When the quick switch to the far wing is on, pohjakasi from the wing is the move; this one is
  // for a far wing who is marked (he comes across instead).
  if (!far || switchOn(state, team, receiver, far)) return null
  const up = clamp(depthToGoal(state, team, passer.pos) - 6, 4, 10)
  return {
    kind: 'threeCircle',
    carrierId: receiver.id,
    trigger: 'wingBackToMiddle',
    moves: [
      { id: passer.id, job: 'run', target: inCourt({ x: side * 7.6, y: passer.pos.y + dir * up }) },
      { id: receiver.id, job: 'carry', target: inCourt({ x: side * 3.2, y: receiver.pos.y + dir * 1 }) },
      { id: far.id, job: 'cover', target: inCourt({ x: side * 0.5, y: receiver.pos.y - dir * 1 }) },
    ],
  }
}

/**
 * Perhonen / the 4-0 figure-eight (oito): a central player passes to his wing, runs up through the
 * centre and comes back out to that wing; the receiver carries inside into the lane he left. The
 * other pair adjusts: the other central player drops a little so the four are never in one line.
 */
export function planButterfly(state: MatchState, team: TeamId): Plan | null {
  if (state.teams[team].tactics.formation !== '4-0') return null
  const pass = passTrigger(state, team)
  if (!pass) return null
  const { passer, receiver } = pass
  if (Math.abs(passer.pos.x) >= 4 || Math.abs(receiver.pos.x) < 4.5) return null
  const side = Math.sign(receiver.pos.x)
  // His own wing (or from the very middle either side).
  if (passer.pos.x * side < -1) return null
  const dir = attackDir(state, team)
  // Deep through the centre (towards the area), then out to the wing well ahead of the receiver.
  const up = clamp(depthToGoal(state, team, passer.pos) - 6, 4, 10)
  const via = inCourt({ x: passer.pos.x * 0.2, y: passer.pos.y + dir * up })
  const target = inCourt({
    x: side * 7.6,
    y: receiver.pos.y + dir * clamp(depthToGoal(state, team, receiver.pos) - 7, 3, 7),
  })
  const carry = inCourt({ x: side * 2.2, y: passer.pos.y + dir * 0.5 })
  const moves: RotationMove[] = [
    { id: passer.id, job: 'run', target, via },
    { id: receiver.id, job: 'carry', target: carry },
  ]
  // The other pair: the other central player staggers his depth (drops 1.5 m behind the ball).
  const other = movable(state, team).find(
    (t) => t.id !== passer.id && t.id !== receiver.id && Math.abs(t.pos.x) < 4.5 && t.pos.x * side < 0,
  )
  if (other)
    moves.push({
      id: other.id,
      job: 'cover',
      target: inCourt({ x: other.pos.x, y: passer.pos.y - dir * 1.5 }),
    })
  return { kind: 'butterfly', carrierId: receiver.id, trigger: 'middleToOwnWing', moves }
}

/** The 4-player rotation / quatro (4-0): one central player passes to the other. */
export function planFourCircle(state: MatchState, team: TeamId): Plan | null {
  if (state.teams[team].tactics.formation !== '4-0') return null
  const pass = passTrigger(state, team)
  if (!pass) return null
  const { passer, receiver } = pass
  if (Math.abs(passer.pos.x) >= 4 || Math.abs(receiver.pos.x) >= 4) return null
  if (Math.abs(passer.pos.x - receiver.pos.x) < 2.5) return null
  const sideP = Math.sign(passer.pos.x - receiver.pos.x) || 1
  // The ala on the passer's side moves in between the lines; the passer goes out to his wing.
  const ala = movable(state, team).find(
    (t) => t.id !== passer.id && t.id !== receiver.id && t.pos.x * sideP > 3.5,
  )
  if (!ala) return null
  const dir = attackDir(state, team)
  // The ala goes deep between the lines (towards the area), not a step inside.
  const up = clamp(depthToGoal(state, team, receiver.pos) - 5, 4, 10)
  return {
    kind: 'fourCircle',
    carrierId: receiver.id,
    trigger: 'centreToCentre',
    moves: [
      { id: ala.id, job: 'run', target: inCourt({ x: sideP * 2.4, y: receiver.pos.y + dir * up }) },
      { id: passer.id, job: 'cover', target: inCourt({ x: sideP * 7.4, y: passer.pos.y + dir * 0.5 }) },
    ],
  }
}

/**
 * Diagonal rotation (any formation, 4-0 above all): a central player passes wide and cuts
 * diagonally forward into the opposite half-space; the nearest other player fills the deep central
 * space he left.
 */
export function planDiagonalRotation(state: MatchState, team: TeamId): Plan | null {
  const pass = passTrigger(state, team)
  if (!pass) return null
  const { passer, receiver } = pass
  if (Math.abs(passer.pos.x) >= 4 || Math.abs(receiver.pos.x) < 4.5) return null
  const pivot = pivotOf(state, team)
  if (pivot && (passer.id === pivot.id || receiver.id === pivot.id)) return null
  const dir = attackDir(state, team)
  const side = Math.sign(receiver.pos.x)
  const depth = depthToGoal(state, team, passer.pos)
  const up = clamp(depth - 6, 5, 11)
  const target = inCourt({ x: -side * 1.8, y: passer.pos.y + dir * up })
  if (depthToGoal(state, team, target) < 6) return null
  // Preferred against player-oriented defending: the passer is marked (his man goes with him and
  // leaves the centre), and there is real space where he cuts to.
  if (markerOf(state, passer, 3) < 0 || spaceAt(state, team, target) < 3) return null
  const fillSpot = inCourt({ x: passer.pos.x * 0.5, y: passer.pos.y - dir * 0.5 })
  const fillers = movable(state, team).filter(
    (t) => t.id !== passer.id && t.id !== receiver.id && (!pivot || t.id !== pivot.id),
  )
  if (!fillers.length) return null
  const fill = fillers.reduce((a, t) => (dist(t.pos, fillSpot) < dist(a.pos, fillSpot) ? t : a))
  return {
    kind: 'diagonalRotation',
    carrierId: receiver.id,
    trigger: 'middleToWingCut',
    moves: [
      { id: passer.id, job: 'run', target },
      { id: fill.id, job: 'cover', target: fillSpot },
    ],
  }
}

/**
 * Parallel rotation: a vertical pass up the same side; the passer goes on up that channel past the
 * receiver, who comes inside and short; the far side adjusts its depth (one stays behind).
 */
export function planParallelRotation(state: MatchState, team: TeamId): Plan | null {
  const pass = passTrigger(state, team)
  if (!pass) return null
  const { passer, receiver } = pass
  const dir = attackDir(state, team)
  const forward = (receiver.pos.y - passer.pos.y) * dir
  if (forward < 3 || Math.abs(receiver.pos.x - passer.pos.x) > 4) return null
  if (Math.abs(passer.pos.x) < 2.5 || Math.sign(passer.pos.x) !== Math.sign(receiver.pos.x)) return null
  const pivot = pivotOf(state, team)
  if (pivot && receiver.id === pivot.id) return null
  // The receiver is marked tight (he comes short off his man; the passer goes past).
  if (markerOf(state, receiver, 2.5) < 0) return null
  const side = Math.sign(receiver.pos.x)
  const ahead = clamp(depthToGoal(state, team, receiver.pos) - 6, 3, 8)
  const moves: RotationMove[] = [
    { id: passer.id, job: 'run', target: inCourt({ x: side * 7.8, y: receiver.pos.y + dir * ahead }) },
    { id: receiver.id, job: 'carry', target: inCourt({ x: side * 3, y: receiver.pos.y - dir * 0.5 }) },
  ]
  const far = movable(state, team).filter(
    (t) => t.id !== passer.id && t.id !== receiver.id && (!pivot || t.id !== pivot.id),
  )
  if (far.length) {
    const f = far.reduce((a, t) => ((t.pos.y - a.pos.y) * dir < 0 ? t : a))
    moves.push({ id: f.id, job: 'cover', target: inCourt({ x: -side * 2, y: passer.pos.y }) })
  }
  return { kind: 'parallelRotation', carrierId: receiver.id, trigger: 'verticalSameSide', moves }
}

// =========================================================================== combinations

/** Overlap: a wide carrier held up; the man behind him runs round the outside. */
export function planOverlap(state: MatchState, team: TeamId): Plan | null {
  const c = carrierOf(state, team)
  if (!c) return null
  const dir = attackDir(state, team)
  const depth = depthToGoal(state, team, c.pos)
  const t = state.teams[team].tactics
  const maxDepth = t.formation === '2-2' ? 27 : 22
  if (Math.abs(c.pos.x) < 4.5 || depth > maxDepth || depth < 8) return null
  const marker = defenderInFront(state, c, 4.5, 2.5)
  if (!marker && c.aiHoldTimer < 0.8) return null
  const side = Math.sign(c.pos.x)
  // The outside must be the open side: a marker standing outside him (closing the line) leaves the
  // inside instead (underlap).
  if (marker && marker.pos.x * side > c.pos.x * side + 0.2) return null
  let runner: PlayerState | null = null
  for (const m of movable(state, team)) {
    if (m.id === c.id) continue
    const behind = (c.pos.y - m.pos.y) * dir
    if (behind < 2 || behind > 9 || m.pos.x * side < -1.5) continue
    if (!runner || dist(m.pos, c.pos) < dist(runner.pos, c.pos)) runner = m
  }
  if (!runner) return null
  const target = inCourt({ x: side * 8.2, y: c.pos.y + dir * Math.min(6.5, depth - 4) })
  const via = { x: side * 8.4, y: c.pos.y }
  const ignore = marker?.id ?? -1
  if (
    !pathFree(state, team, runner.pos, via, 1.8, ignore) ||
    !pathFree(state, team, via, target, 2.2, ignore)
  )
    return null
  if (!free(state, team, target, 2.6, ignore)) return null
  const moves: RotationMove[] = [{ id: runner.id, job: 'run', target }]
  const refill = refillDeep(state, team, c, runner)
  if (refill === false) return null
  if (refill) moves.push(refill)
  return { kind: 'overlap', carrierId: c.id, trigger: 'carrierHeldWide', moves }
}

/**
 * Refill: if `runner` was the deepest, the nearest other teammate drops into his place (a cover
 * move). Null when no refill is needed and balance holds, false when the move would leave nobody.
 */
function refillDeep(
  state: MatchState,
  team: TeamId,
  c: PlayerState,
  runner: PlayerState,
  extra: readonly number[] = [],
): RotationMove | null | false {
  const deepest = deepestOf(state, team)
  if (deepest && deepest.id === runner.id) {
    const spot = { x: runner.pos.x * 0.4, y: runner.pos.y }
    const others = movable(state, team).filter(
      (t) => t.id !== c.id && t.id !== runner.id && !extra.includes(t.id),
    )
    if (!others.length) return false
    const cover = others.reduce((a, t) => (dist(t.pos, spot) < dist(a.pos, spot) ? t : a))
    return { id: cover.id, job: 'cover', target: spot }
  }
  return balanceOk(state, team, c.pos.y, [c.id, runner.id, ...extra]) ? null : false
}

/** Pivot exchange (3-1, also a temporary pivot in 4-0 / 2-2): the marked pivot comes short. */
export function planPivot(state: MatchState, team: TeamId): Plan | null {
  const c = carrierOf(state, team)
  if (!c) return null
  const formation = state.teams[team].tactics.formation
  const dir = attackDir(state, team)
  const goalY = goalYOf(state, team)
  const mates = outfield(state, team).filter((t) => t.id !== c.id)
  if (mates.length < 3) return null
  const pivot = mates.reduce((a, t) => ((t.pos.y - a.pos.y) * dir > 0 ? t : a))
  if (!isMovable(state, pivot)) return null
  const ahead = (pivot.pos.y - c.pos.y) * dir
  // A 4-0 / 2-2 has no fixed pivot: the most advanced man acts as a temporary pivot when well ahead.
  if (ahead < (formation === '3-1' ? 7 : 6) || pivot.pos.y * dir < 3) return null
  const marked = state.players.some(
    (o) =>
      o.team !== team &&
      o.role !== 'GK' &&
      dist(o.pos, pivot.pos) < 1.8 &&
      (o.pos.y - pivot.pos.y) * dir > -0.3,
  )
  if (!marked || pressureOn(state, c) > 0.6) return null
  const ballSide = Math.sign(c.pos.x) || 1
  const deepest = deepestOf(state, team)
  const cands = mates.filter(
    (t) =>
      isMovable(state, t) &&
      t.id !== pivot.id &&
      t.id !== deepest?.id &&
      t.pos.x * ballSide < 1 &&
      (t.pos.y - c.pos.y) * dir > -3,
  )
  if (!cands.length) return null
  const ala = cands.reduce((a, t) => (t.pos.x * ballSide < a.pos.x * ballSide ? t : a))
  const drop = inCourt({
    x: clamp(pivot.pos.x * 0.5 + c.pos.x * 0.3, -7, 7),
    y: c.pos.y + dir * clamp(ahead * 0.45, 4.5, 7),
  })
  const runTo = inCourt({
    x: clamp(pivot.pos.x - ballSide * 1.5, -5, 5),
    y: goalY - dir * Math.max(4.5, (goalY - pivot.pos.y) * dir),
  })
  if (!pathFree(state, team, ala.pos, runTo, 1.5, [markerOf(state, ala), markerOf(state, pivot)])) return null
  if (!balanceOk(state, team, c.pos.y, [c.id, pivot.id, ala.id])) return null
  return {
    kind: 'pivot',
    carrierId: c.id,
    trigger: formation === '3-1' ? 'pivotMarkedTight' : 'temporaryPivot',
    moves: [
      { id: pivot.id, job: 'drop', target: drop },
      { id: ala.id, job: 'run', target: runTo },
    ],
  }
}

export function backPostSpots(state: MatchState, team: TeamId, c: PlayerState) {
  const dir = attackDir(state, team)
  const goalY = goalYOf(state, team)
  const side = Math.sign(c.pos.x) || 1
  return {
    back: { x: -side * 2, y: goalY - dir * 2.8 },
    top: { x: -side * 2.5, y: goalY - dir * 8 },
    front: { x: side * 0.8, y: goalY - dir * 6 },
  }
}

/**
 * Predicted time (s from now) a ball across from the carrier would arrive at `spot`: the time he
 * needs to get to a crossing position (about 10 m from goal), a short preparation and the ball's
 * travel at about 12 m/s.
 */
export function deliveryTime(state: MatchState, team: TeamId, c: PlayerState, spot: Vec2): number {
  const depth = depthToGoal(state, team, c.pos)
  const speed = Math.max(2.5, Math.hypot(c.vel.x, c.vel.y))
  const carry = Math.max(0, depth - 10) / speed
  return carry + 0.35 + dist(c.pos, spot) / 12
}

/**
 * Back post: ball on a wing near goal; back post and front of the area, swapping after a while. The
 * back-post man is timed: he starts so that he arrives about when a ball across would.
 */
export function planBackPost(state: MatchState, team: TeamId): Plan | null {
  const c = carrierOf(state, team)
  if (!c) return null
  if (Math.abs(c.pos.x) < 3 || depthToGoal(state, team, c.pos) > 14) return null
  const deepest = deepestOf(state, team)
  const mates = movable(state, team).filter((t) => t.id !== c.id && t.id !== deepest?.id)
  if (mates.length < 2) return null
  const s = backPostSpots(state, team, c)
  const a = mates.reduce((x, t) => (dist(t.pos, s.back) < dist(x.pos, s.back) ? t : x))
  const rest = mates.filter((t) => t.id !== a.id)
  const b = rest.reduce((x, t) => (dist(t.pos, s.front) < dist(x.pos, s.front) ? t : x))
  if (dist(a.pos, s.back) > 14) return null
  // Not too early: arrive about with the ball (not stand there marked waiting for it).
  const wait = Math.max(0, deliveryTime(state, team, c, s.back) - estimateTimeToReach(a, s.back) - 0.15)
  return {
    kind: 'backPost',
    carrierId: c.id,
    trigger: 'ballWideNearGoal',
    moves: [
      {
        id: a.id,
        job: 'post',
        target: s.back,
        ...(wait > 0.1 ? { startAt: state.time + Math.min(wait, 1.2) } : {}),
      },
      { id: b.id, job: 'run', target: s.front },
    ],
  }
}

/**
 * Wing clearance (laidan tyhjennys): a wide teammate ahead of the ball, tightly marked, runs
 * diagonally inside to take his marker away; a deeper teammate waits to attack the wing he leaves.
 * Which of them gets the ball depends on what the marker does (see the runtime branches).
 */
export function planWingClearance(state: MatchState, team: TeamId): Plan | null {
  const c = carrierOf(state, team)
  if (!c || pressureOn(state, c) > 0.5) return null
  const depth = depthToGoal(state, team, c.pos)
  if (depth < 10 || depth > 30) return null
  const dir = attackDir(state, team)
  const ballSide = Math.sign(c.pos.x) || 1
  let best: { w: PlayerState; f: PlayerState; score: number } | null = null
  for (const w of movable(state, team)) {
    if (w.id === c.id || Math.abs(w.pos.x) < 5) continue
    const ahead = (w.pos.y - c.pos.y) * dir
    if (ahead < 1 || ahead > 9) continue
    if (Math.abs(c.pos.x) > 3 && Math.sign(w.pos.x) !== ballSide) continue
    const m = markerOf(state, w, 2.3)
    if (m < 0) continue
    // The filler: deeper on that side (or central), able to get to the wing.
    for (const f of movable(state, team)) {
      if (f.id === c.id || f.id === w.id) continue
      if ((f.pos.y - w.pos.y) * dir > -2 || f.pos.x * Math.sign(w.pos.x) < -2) continue
      if (dist(f.pos, w.pos) > 12) continue
      const score = -dist(f.pos, w.pos)
      if (!best || score > best.score) best = { w, f, score }
    }
  }
  if (!best) return null
  const { w, f } = best
  const target = inCourt({ x: w.pos.x * 0.25, y: w.pos.y + dir * 3 })
  if (depthToGoal(state, team, target) < 5) return null
  if (!balanceOk(state, team, c.pos.y, [c.id, w.id, f.id]) && !balanceOk(state, team, c.pos.y, [c.id, w.id]))
    return null
  return {
    kind: 'wingClearance',
    carrierId: c.id,
    trigger: 'wideManMarked',
    moves: [
      { id: w.id, job: 'run', target },
      { id: f.id, job: 'cover', target: { ...f.pos } },
    ],
  }
}

/** The space a wing clearance leaves: the clearing man's original wing, a little further up. */
export function vacatedWing(state: MatchState, team: TeamId, from: Vec2): Vec2 {
  const dir = attackDir(state, team)
  return inCourt({ x: Math.sign(from.x) * 7.6, y: from.y + dir * 1.5 })
}

/** Two attackers ahead of the ball, one on each side of the carrier's line. */
function frontPair(state: MatchState, team: TeamId, c: PlayerState, minAhead: number) {
  const dir = attackDir(state, team)
  const ahead = movable(state, team).filter((t) => t.id !== c.id && (t.pos.y - c.pos.y) * dir >= minAhead)
  let best: [PlayerState, PlayerState] | null = null
  let bestScore = -Infinity
  for (let i = 0; i < ahead.length; i++)
    for (let j = i + 1; j < ahead.length; j++) {
      const a = ahead[i]!
      const b = ahead[j]!
      const gap = Math.abs(a.pos.x - b.pos.x)
      if (gap < 3) continue
      const score = gap - Math.abs(a.pos.y - b.pos.y) * 0.3
      if (score > bestScore) {
        bestScore = score
        best = a.pos.x < b.pos.x ? [a, b] : [b, a]
      }
    }
  return best
}

/**
 * Cross run (ristiinjuoksu): two attackers ahead of the ball swap sides diagonally, the second one
 * slightly later so they never arrive at the crossing point together. The carrier plays the one with
 * the better lane (runnerOption).
 */
export function planCrossRun(state: MatchState, team: TeamId): Plan | null {
  const c = carrierOf(state, team)
  // The carrier needs time to pick one of the runners.
  if (!c || pressureOn(state, c) > 0.45) return null
  const depth = depthToGoal(state, team, c.pos)
  if (depth > 26 || depth < 9) return null
  // A defender right in front of him: the way past is the 1-2, not a ball over to the runners.
  if (defenderInFront(state, c, 3, 1.8)) return null
  const pair = frontPair(state, team, c, 2.5)
  if (!pair) return null
  const [l, r] = pair
  const dir = attackDir(state, team)
  const adv = (p: PlayerState) => clamp(depthToGoal(state, team, p.pos) - 5, 2, 6)
  const tl = inCourt({ x: clamp(r.pos.x * 0.7, -6.5, 6.5), y: l.pos.y + dir * adv(l) })
  const tr = inCourt({ x: clamp(l.pos.x * 0.7, -6.5, 6.5), y: r.pos.y + dir * adv(r) })
  if (depthToGoal(state, team, tl) < 4.5 || depthToGoal(state, team, tr) < 4.5) return null
  if (spaceAt(state, team, tl) < 2 && spaceAt(state, team, tr) < 2) return null
  const ignore = [markerOf(state, l), markerOf(state, r)]
  if (!pathFree(state, team, l.pos, tl, 1, ignore) || !pathFree(state, team, r.pos, tr, 1, ignore))
    return null
  if (!balanceOk(state, team, c.pos.y, [c.id, l.id, r.id])) return null
  // Stagger: the one with the shorter way goes second, so their times at the crossing differ.
  const el = estimateTimeToReach(l, tl)
  const er = estimateTimeToReach(r, tr)
  const delay = clamp(0.45 - Math.abs(el - er) * 0.5, 0.15, 0.45)
  const first = el >= er ? l : r
  return {
    kind: 'crossRun',
    carrierId: c.id,
    trigger: 'frontPairCross',
    moves: [
      { id: l.id, job: 'run', target: tl, ...(first.id === l.id ? {} : { startAt: state.time + delay }) },
      { id: r.id, job: 'run', target: tr, ...(first.id === r.id ? {} : { startAt: state.time + delay }) },
    ],
  }
}

/**
 * Double cut (kaksoisleikkaus): two players attack different spaces behind the defence at once (near
 * and far post, or central and wide) — their paths need not cross. Higher risk: needs real balance.
 */
export function planDoubleCut(state: MatchState, team: TeamId): Plan | null {
  const c = carrierOf(state, team)
  if (!c || pressureOn(state, c) > 0.55) return null
  const depth = depthToGoal(state, team, c.pos)
  if (depth > 19 || depth < 8) return null
  const dir = attackDir(state, team)
  const goalY = goalYOf(state, team)
  const side = Math.sign(c.pos.x) || 1
  const near = inCourt({ x: side * 2, y: goalY - dir * 4 })
  const far = inCourt({ x: -side * 2.2, y: goalY - dir * 3.5 })
  const cands = movable(state, team).filter((t) => t.id !== c.id && (t.pos.y - c.pos.y) * dir > -2)
  if (cands.length < 2) return null
  const a = cands.reduce((x, t) => (dist(t.pos, near) < dist(x.pos, near) ? t : x))
  const rest = cands.filter((t) => t.id !== a.id)
  const b = rest.reduce((x, t) => (dist(t.pos, far) < dist(x.pos, far) ? t : x))
  if (dist(a.pos, near) > 13 || dist(b.pos, far) > 14) return null
  if (spaceAt(state, team, near) < 1.8 && spaceAt(state, team, far) < 1.8) return null
  // Real rest defence: one man behind the ball and not just the minimum.
  if (!balanceOk(state, team, c.pos.y, [c.id, a.id, b.id])) return null
  return {
    kind: 'doubleCut',
    carrierId: c.id,
    trigger: 'twoRunsBehind',
    moves: [
      { id: a.id, job: 'run', target: near },
      { id: b.id, job: 'run', target: far, startAt: state.time + 0.2 },
    ],
  }
}

/**
 * Balance for a pass-and-stay move: the ball is about to go forward and the passer stays where he
 * is, so he counts as the man behind it.
 */
function passerBalance(state: MatchState, team: TeamId, c: PlayerState, busy: readonly number[]): boolean {
  return balanceOk(state, team, c.pos.y + attackDir(state, team) * 1.5, busy)
}

/**
 * A runner's target ahead of `t` in a channel, with the runner first there: free space, a path, and
 * he gets there before any defender (other than `ignore`).
 */
function reachable(state: MatchState, team: TeamId, t: PlayerState, target: Vec2, ignore: readonly number[]) {
  if (spaceAt(state, team, target, ignore[0] ?? -1) < 2.3) return false
  if (!pathFree(state, team, t.pos, target, 1.2, ignore)) return false
  return estimateTimeToReach(t, target) < opponentEta(state, team, target, ignore) + 0.15
}

/**
 * Paralela: the carrier on a wing with time; a teammate behind or inside him on that side runs
 * down the line into the space behind the defender, to be played into his path.
 */
export function planParalela(state: MatchState, team: TeamId): Plan | null {
  const c = carrierOf(state, team)
  if (!c || Math.abs(c.pos.x) < 4.5 || pressureOn(state, c) > 0.55) return null
  const depth = depthToGoal(state, team, c.pos)
  if (depth > 26 || depth < 8) return null
  const dir = attackDir(state, team)
  const side = Math.sign(c.pos.x)
  // The carrier has time: no defender committed to him (then it is the overlap).
  if (spaceAt(state, team, c.pos) < 2.5 || defenderInFront(state, c, 3.5, 2.5)) return null
  const defender = defenderInFront(state, c, 6, 3)
  const target = inCourt({ x: side * 8.3, y: c.pos.y + dir * Math.min(7, depth - 4) })
  let runner: PlayerState | null = null
  for (const t of movable(state, team)) {
    if (t.id === c.id || t.pos.x * side < 0) continue
    const behind = (c.pos.y - t.pos.y) * dir
    if (behind < -1 || behind > 8 || dist(t.pos, c.pos) > 9) continue
    if (
      !reachable(state, team, t, target, defender ? [defender.id, markerOf(state, t)] : [markerOf(state, t)])
    )
      continue
    if (!runner || dist(t.pos, c.pos) < dist(runner.pos, c.pos)) runner = t
  }
  if (!runner) return null
  const moves: RotationMove[] = [{ id: runner.id, job: 'run', target }]
  const refill = refillDeep(state, team, c, runner)
  if (refill === false) return null
  if (refill) moves.push(refill)
  return { kind: 'paralela', carrierId: c.id, trigger: 'laneDownTheLine', moves }
}

/** Diagonal run: a teammate ahead attacks the space across the defensive channels towards goal. */
export function planDiagonalRun(state: MatchState, team: TeamId): Plan | null {
  const c = carrierOf(state, team)
  if (!c || pressureOn(state, c) > 0.6) return null
  const depth = depthToGoal(state, team, c.pos)
  if (depth > 26 || depth < 8) return null
  const dir = attackDir(state, team)
  let best: { t: PlayerState; target: Vec2; score: number } | null = null
  for (const t of movable(state, team)) {
    if (t.id === c.id || (t.pos.y - c.pos.y) * dir < -1) continue
    const target = inCourt({ x: clamp(-t.pos.x * 0.35 + c.pos.x * 0.1, -6, 6), y: t.pos.y + dir * 5 })
    if (depthToGoal(state, team, target) < 5 || Math.abs(target.x - t.pos.x) < 2.5) continue
    if (!reachable(state, team, t, target, [markerOf(state, t)])) continue
    if (laneOpenness(state, team, c.pos, target) < 1) continue
    const score = spaceAt(state, team, target) - dist(t.pos, target) * 0.1
    if (!best || score > best.score) best = { t, target, score }
  }
  if (!best || !passerBalance(state, team, c, [best.t.id])) return null
  return {
    kind: 'diagonalRun',
    carrierId: c.id,
    trigger: 'gapBetweenDefenders',
    moves: [{ id: best.t.id, job: 'run', target: best.target }],
  }
}

/**
 * Underlap (sisäkautta nousu): a wide carrier drawing pressure; a teammate behind runs through the
 * inside channel past his defender (never into the space the pivot occupies).
 */
export function planUnderlap(state: MatchState, team: TeamId): Plan | null {
  const c = carrierOf(state, team)
  if (!c || Math.abs(c.pos.x) < 4.5) return null
  const depth = depthToGoal(state, team, c.pos)
  if (depth > 24 || depth < 8) return null
  const marker = defenderInFront(state, c, 4.5, 3)
  if (!marker) return null
  const dir = attackDir(state, team)
  const side = Math.sign(c.pos.x)
  // The inside must be the open side: his marker outside him (closing the line). A marker straight
  // in front or inside leaves the outside (overlap).
  if (marker.pos.x * side < c.pos.x * side + 0.2) return null
  const target = inCourt({ x: side * 2.8, y: c.pos.y + dir * Math.min(5, depth - 4) })
  // Not into an occupied pivot space.
  if (outfield(state, team).some((t) => t.id !== c.id && dist(t.pos, target) < 3)) return null
  let runner: PlayerState | null = null
  for (const t of movable(state, team)) {
    if (t.id === c.id) continue
    const behind = (c.pos.y - t.pos.y) * dir
    if (behind < 1 || behind > 8 || Math.abs(t.pos.x) > Math.abs(c.pos.x) + 0.5 || t.pos.x * side < -3)
      continue
    if (!pathFree(state, team, t.pos, target, 1.3, [marker?.id ?? -1, markerOf(state, t)])) continue
    if (!runner || dist(t.pos, c.pos) < dist(runner.pos, c.pos)) runner = t
  }
  if (!runner || spaceAt(state, team, target, marker?.id ?? -1) < 2) return null
  const moves: RotationMove[] = [{ id: runner.id, job: 'run', target }]
  const refill = refillDeep(state, team, c, runner)
  if (refill === false) return null
  if (refill) moves.push(refill)
  return { kind: 'underlap', carrierId: c.id, trigger: 'widePressureInsideLane', moves }
}

/**
 * Third-man combination: A (the carrier) can find B; C starts his run into the space beyond B
 * before the ball reaches B, and B plays him in first time (job `link`).
 */
export function planThirdMan(state: MatchState, team: TeamId): Plan | null {
  const c = carrierOf(state, team)
  if (!c) return null
  const depth = depthToGoal(state, team, c.pos)
  // From midcourt on (in the build-up the formation's rotation does the work).
  if (depth > 24 || depth < 9) return null
  const dir = attackDir(state, team)
  let best: { b: PlayerState; r: PlayerState; target: Vec2; score: number } | null = null
  for (const b of movable(state, team)) {
    if (b.id === c.id) continue
    const d = dist(b.pos, c.pos)
    // The link is a ball forward (into the pivot or a man ahead), not a square pass.
    if (d < 4 || d > 12 || (b.pos.y - c.pos.y) * dir < 2) continue
    if (spaceAt(state, team, b.pos) < 2.2 || passInterceptable(state, team, c.pos, b.pos)) continue
    for (const r of movable(state, team)) {
      if (r.id === c.id || r.id === b.id) continue
      for (const lat of [-3, 3]) {
        const target = inCourt({ x: clamp(b.pos.x + lat, -7.8, 7.8), y: b.pos.y + dir * 5 })
        if (depthToGoal(state, team, target) < 4.5 || dist(target, r.pos) > 13) continue
        if (spaceAt(state, team, target) < 2.5) continue
        if (!pathFree(state, team, b.pos, target, 1.3, markerOf(state, b))) continue
        if (passInterceptable(state, team, b.pos, target)) continue
        // C must be there about when B could play it (ball to B, then on): not beaten to it.
        const ballTime = d / 11 + dist(b.pos, target) / 11 + 0.2
        const mine = estimateTimeToReach(r, target)
        if (mine > ballTime + 1.2 || opponentEta(state, team, target) < Math.max(mine, ballTime) - 0.4)
          continue
        const score =
          spaceAt(state, team, target) - mine * 0.3 + laneOpenness(state, team, c.pos, b.pos) * 0.3
        if (!best || score > best.score) best = { b, r, target, score }
      }
    }
  }
  if (!best || !passerBalance(state, team, c, [best.r.id])) return null
  return {
    kind: 'thirdMan',
    carrierId: c.id,
    trigger: 'linkAndRunner',
    moves: [
      { id: best.b.id, job: 'link', target: { ...best.b.pos }, passTo: best.r.id },
      { id: best.r.id, job: 'run', target: best.target },
    ],
  }
}

/**
 * Pivot layoff (pivotin pudotus): our most advanced player has it near goal with his back to goal
 * or marked tight; the nearest teammate comes to the lay-off spot behind him and another attacks the
 * far post. The pivot himself decides: turn and shoot, lay it off or another pass.
 */
export function planPivotLayoff(state: MatchState, team: TeamId): Plan | null {
  const c = carrierOf(state, team)
  if (!c || depthToGoal(state, team, c.pos) > 15) return null
  const dir = attackDir(state, team)
  if (outfield(state, team).some((t) => t.id !== c.id && (t.pos.y - c.pos.y) * dir > 0)) return null
  const goalDir = { x: -c.pos.x, y: goalYOf(state, team) - c.pos.y }
  const facingGoal = Math.cos(c.facing) * goalDir.x + Math.sin(c.facing) * goalDir.y
  const marked = markerOf(state, c, 1.8) >= 0
  // A pivot: in the middle channel, back to goal (or marked tight there). Out wide near goal it is
  // the back-post play instead.
  if (Math.abs(c.pos.x) > 4.5) return null
  if (facingGoal > 0 && !(marked && Math.abs(c.pos.x) < 3)) return null
  const side = c.pos.x === 0 ? 1 : -Math.sign(c.pos.x)
  const spot = inCourt({ x: c.pos.x + side * 2, y: c.pos.y - dir * 3.5 })
  const mates = movable(state, team).filter((t) => t.id !== c.id)
  if (mates.length < 2) return null
  const s = mates.reduce((a, t) => (dist(t.pos, spot) < dist(a.pos, spot) ? t : a))
  if (dist(s.pos, spot) > 10) return null
  const moves: RotationMove[] = [{ id: s.id, job: 'drop', target: spot }]
  const farPost = inCourt({ x: (c.pos.x > 0 ? -1 : 1) * 2, y: goalYOf(state, team) - dir * 3 })
  const others = mates.filter((t) => t.id !== s.id)
  const post = others.reduce((a, t) => (dist(t.pos, farPost) < dist(a.pos, farPost) ? t : a))
  if (balanceOk(state, team, c.pos.y, [c.id, s.id, post.id]) && dist(post.pos, farPost) < 13)
    moves.push({ id: post.id, job: 'post', target: farPost })
  return { kind: 'pivotLayoff', carrierId: c.id, trigger: 'pivotBackToGoal', moves }
}

/**
 * Opposite movement (vastaliike): of two attackers ahead of the ball, the nearer one comes towards
 * the ball while the other goes in behind — opposite directions, never the same receiving zone.
 */
export function planOppositeMove(state: MatchState, team: TeamId): Plan | null {
  const c = carrierOf(state, team)
  if (!c) return null
  const depth = depthToGoal(state, team, c.pos)
  if (depth > 28 || depth < 10) return null
  const dir = attackDir(state, team)
  const ahead = movable(state, team).filter((t) => t.id !== c.id && (t.pos.y - c.pos.y) * dir > 3)
  if (ahead.length < 2) return null
  ahead.sort((a, b) => dist(a.pos, c.pos) - dist(b.pos, c.pos) || a.id - b.id)
  const drop = ahead[0]!
  const deep = ahead[1]!
  if (markerOf(state, drop, 2.5) < 0 && markerOf(state, deep, 2.5) < 0) return null
  const dropTo = inCourt({
    x: drop.pos.x * 0.7 + c.pos.x * 0.3,
    y: c.pos.y + dir * clamp((drop.pos.y - c.pos.y) * dir * 0.5, 3.5, 6),
  })
  const runTo = inCourt({
    x: deep.pos.x * 0.8,
    y: goalYOf(state, team) - dir * Math.max(5, depthToGoal(state, team, deep.pos) - 4),
  })
  if (dist(dropTo, runTo) < 5) return null
  if (!pathFree(state, team, deep.pos, runTo, 1.2, markerOf(state, deep))) return null
  if (!balanceOk(state, team, c.pos.y, [c.id, deep.id])) return null
  return {
    kind: 'oppositeMove',
    carrierId: c.id,
    trigger: 'twoAheadMarked',
    moves: [
      { id: drop.id, job: 'drop', target: dropTo },
      { id: deep.id, job: 'run', target: runTo },
    ],
  }
}

/**
 * Wide overload (laidan ylikuormitus): ball on a wing; a third man comes to the ball side (one
 * short inside, one ahead) for a local 3 v 2; the last one keeps the weak side open (switch option
 * and balance). Never everybody to the ball side.
 */
export function planWideOverload(state: MatchState, team: TeamId): Plan | null {
  const c = carrierOf(state, team)
  if (!c || Math.abs(c.pos.x) < 4.5) return null
  // In the attacking half (in the build-up the formation's rotation does the work).
  const depth = depthToGoal(state, team, c.pos)
  if (depth > 20 || depth < 9) return null
  const dir = attackDir(state, team)
  const side = Math.sign(c.pos.x)
  const mates = movable(state, team).filter((t) => t.id !== c.id)
  if (mates.length < 3) return null
  const support = inCourt({ x: side * 3.6, y: c.pos.y - dir * 2.5 })
  const ahead = inCourt({ x: side * 5.8, y: c.pos.y + dir * Math.min(4.5, depth - 4) })
  const weak = inCourt({ x: -side * 5, y: c.pos.y - dir * 1.5 })
  // Assign by nearness: weak side first (the man furthest across stays there).
  const w = mates.reduce((a, t) => (t.pos.x * side < a.pos.x * side ? t : a))
  const rest = mates.filter((t) => t.id !== w.id)
  const s = rest.reduce((a, t) => (dist(t.pos, support) < dist(a.pos, support) ? t : a))
  const r = rest
    .filter((t) => t.id !== s.id)
    .reduce((a, t) => (dist(t.pos, ahead) < dist(a.pos, ahead) ? t : a))
  // Only when the ball side is short of men now (otherwise it is already overloaded) and the carrier
  // is not already winning locally.
  const ballSide = outfield(state, team).filter((t) => t.pos.x * side > 1.5).length
  if (ballSide >= 3) return null
  const localDef = state.players.filter(
    (o) => o.team !== team && o.role !== 'GK' && dist(o.pos, c.pos) < 7,
  ).length
  if (localDef < ballSide) return null
  if (spaceAt(state, team, ahead) < 1.8 && spaceAt(state, team, support) < 1.8) return null
  return {
    kind: 'wideOverload',
    carrierId: c.id,
    trigger: 'ballWideShort',
    moves: [
      { id: s.id, job: 'drop', target: support },
      { id: r.id, job: 'run', target: ahead },
      { id: w.id, job: 'cover', target: weak },
    ],
  }
}

/**
 * Switch of play (painopisteen vaihto): the opponents have shifted over to the ball side and a
 * teammate is free on the other side: straight across if that ball is safe, else through the deep
 * man (who plays it on at once).
 */
export function planSwitchPlay(state: MatchState, team: TeamId): Plan | null {
  const c = carrierOf(state, team)
  if (!c || Math.abs(c.pos.x) < 2.5) return null
  const depth = depthToGoal(state, team, c.pos)
  if (depth > 34 || depth < 8) return null
  const side = Math.sign(c.pos.x)
  const opp = state.players.filter((o) => o.team !== team && o.role !== 'GK')
  const shift = opp.reduce((sum, o) => sum + o.pos.x * side, 0) / Math.max(1, opp.length)
  if (shift < 1.5) return null
  const dir = attackDir(state, team)
  const far = movable(state, team).filter((t) => t.id !== c.id && t.pos.x * side < -3)
  if (!far.length) return null
  const f = far.reduce((a, t) => (spaceAt(state, team, t.pos) > spaceAt(state, team, a.pos) ? t : a))
  if (spaceAt(state, team, f.pos) < 3.2) return null
  const width = inCourt({ x: -side * 7.4, y: f.pos.y + dir * 1.5 })
  const direct = dist(c.pos, f.pos) < 17 && !passInterceptable(state, team, c.pos, f.pos)
  const moves: RotationMove[] = [{ id: f.id, job: 'run', target: width }]
  if (!direct) {
    const d = deepestOf(state, team, [c.id, f.id])
    if (!d || !isMovable(state, d)) return null
    if (passInterceptable(state, team, c.pos, d.pos) || passInterceptable(state, team, d.pos, f.pos))
      return null
    moves.push({ id: d.id, job: 'switch', target: { ...d.pos }, passTo: f.id })
  }
  return { kind: 'switchPlay', carrierId: c.id, trigger: direct ? 'shiftedDirect' : 'shiftedViaDeep', moves }
}

/**
 * Isolation (tilan tyhjennys 1v1-peliin): a good dribbler with one defender in front and no cover;
 * the teammates near him clear away from his corridor (pulling their men with them), one stays as
 * the safe option behind.
 */
export function planIsolation(state: MatchState, team: TeamId): Plan | null {
  const c = carrierOf(state, team)
  if (!c || c.profile.attributes.dribbling < 62) return null
  // Near goal, out wide or in a half-space, and never the last man.
  const depth = depthToGoal(state, team, c.pos)
  if (depth > 16 || depth < 7 || Math.abs(c.pos.x) < 3) return null
  if (deepestOf(state, team)?.id === c.id) return null
  const dir = attackDir(state, team)
  const def = defenderInFront(state, c, 4.5, 2.5)
  if (!def) return null
  // No second defender close to the 1 v 1.
  if (
    state.players.some(
      (o) => o.team !== team && o.role !== 'GK' && o.id !== def.id && dist(o.pos, c.pos) < 4.5,
    )
  )
    return null
  const near = movable(state, team).filter((t) => t.id !== c.id && dist(t.pos, c.pos) < 8)
  if (!near.length) return null
  const deepest = deepestOf(state, team, [c.id])
  const moves: RotationMove[] = []
  for (const t of near) {
    if (deepest && t.id === deepest.id) continue
    const away = Math.sign(t.pos.x - c.pos.x) || -Math.sign(c.pos.x) || 1
    moves.push({ id: t.id, job: 'cover', target: inCourt({ x: c.pos.x + away * 6, y: t.pos.y - dir * 1 }) })
  }
  if (!moves.length) return null
  return { kind: 'isolation', carrierId: c.id, trigger: 'dribblerOneOnOne', moves }
}

/** Every coordinated planner the selection evaluates (patterns are pass-triggered). */
export const PATTERN_PLANNERS: readonly ((s: MatchState, t: TeamId) => Plan | null)[] = [
  planBaseEight,
  planBaseEightWing,
  planThreeCircle,
  planButterfly,
  planFourCircle,
  planDiagonalRotation,
  planParallelRotation,
]

export const COMBINATION_PLANNERS: readonly ((s: MatchState, t: TeamId) => Plan | null)[] = [
  planBackPost,
  planOverlap,
  planPivot,
  planWingClearance,
  planCrossRun,
  planDoubleCut,
  planParalela,
  planDiagonalRun,
  planUnderlap,
  planThirdMan,
  planPivotLayoff,
  planOppositeMove,
  planWideOverload,
  planSwitchPlay,
  planIsolation,
]
