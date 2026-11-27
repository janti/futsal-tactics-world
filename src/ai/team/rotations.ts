/**
 * Attacking rotations (Milestone 6, stage 3). A rotation is a short team move with named
 * participants, each with a job and a target:
 * - `wallPass` (1-2): the carrier with a defender in front plays it into a teammate (the wall) and
 *   runs past the defender; the wall returns it first time into his path.
 * - `overlap`: a wide carrier held up by his marker; the teammate behind him on that side runs round
 *   the outside down the wing; a third man covers the space he left.
 * - `pivot` (3-1): the pivot, marked tight, comes short towards the ball; the far ala runs into the
 *   space he left and becomes the new pivot (the dynamic roles then swap).
 * - `fourZero` (4-0): a central player passes out to the wing and follows his pass on the inside;
 *   the far ala tucks in behind to keep the back of the four.
 * - `backPost`: the ball on a wing near goal — one man attacks the back post, another the front of
 *   the area; after a moment without the ball across they swap (back post out, front man across).
 *
 * Every rotation has preconditions (where the ball is, who is free), a trigger, a time limit,
 * balance (one outfield player always stays behind the ball, never a runner) and ends when the ball
 * reaches a runner (completed), when the time is up, when the ball goes to somebody outside the
 * rotation, or when possession is lost or the ball goes dead (cancelled).
 */
import { clamp } from '../../core/math/scalar'
import { closestOnSegment, dist, type Vec2 } from '../../core/math/vec2'
import { laneOpenness, pressureOn } from '../../physics/PassingPhysics'
import { estimateTimeToReach } from '../../physics/PlayerPhysics'
import type { MatchState, PlayerState, TeamId } from '../../simulation/MatchState'
import { COURT } from '../../simulation/SimulationConfig'
import { deepestOutfield } from '../common'
import { passInterceptable } from '../passing'

export type RotationKind = 'wallPass' | 'overlap' | 'pivot' | 'fourZero' | 'backPost'
export const ROTATION_KINDS: readonly RotationKind[] = [
  'wallPass',
  'overlap',
  'pivot',
  'fourZero',
  'backPost',
]

/**
 * `run`: attacks space and is the one the ball should reach (its arrival completes the rotation);
 * `wall`: the 1-2 partner; `cover`: fills the space left behind; `drop`: comes short to show;
 * `post`: takes a spot in front of goal and strikes first time.
 */
export type RotationJob = 'run' | 'wall' | 'cover' | 'drop' | 'post'

export interface RotationMove {
  id: number
  job: RotationJob
  target: Vec2
}

export interface Rotation {
  kind: RotationKind
  /** The carrier the rotation is built round (the wall pass: the passer, who is also the runner). */
  carrierId: number
  moves: RotationMove[]
  /** Simulation time it started / ends at the latest. */
  started: number
  until: number
  /** Back-post rotation: the men have swapped. */
  swapped: boolean
  /** Wall pass: the wall has had the ball. */
  wallTouched: boolean
}

export interface RotationStats {
  started: number
  completed: number
}

export const ROTATION = {
  /** Seconds after a rotation before the team starts another. */
  cooldown: 2,
  /** Time limit per kind (seconds). */
  duration: { wallPass: 2.2, overlap: 3, pivot: 2.8, fourZero: 2.8, backPost: 3.4 },
  /** Back-post rotation: the men swap after this long without the ball across. */
  backPostSwap: 1.5,
} as const satisfies Record<string, unknown>

export function emptyRotationStats(): Record<RotationKind, RotationStats> {
  return {
    wallPass: { started: 0, completed: 0 },
    overlap: { started: 0, completed: 0 },
    pivot: { started: 0, completed: 0 },
    fourZero: { started: 0, completed: 0 },
    backPost: { started: 0, completed: 0 },
  }
}

const inCourt = (v: Vec2): Vec2 => ({
  x: clamp(v.x, -COURT.halfWidth + 0.8, COURT.halfWidth - 0.8),
  y: clamp(v.y, -COURT.halfLength + 1.2, COURT.halfLength - 1.2),
})

/** The rotation move this player has (null if he is not part of an active rotation). */
export function rotationMove(state: MatchState, p: PlayerState): RotationMove | null {
  const r = state.rotation[p.team]
  if (!r) return null
  return r.moves.find((m) => m.id === p.id) ?? null
}

export function startRotation(
  state: MatchState,
  team: TeamId,
  kind: RotationKind,
  carrierId: number,
  moves: RotationMove[],
): Rotation {
  const r: Rotation = {
    kind,
    carrierId,
    moves,
    started: state.time,
    until: state.time + ROTATION.duration[kind],
    swapped: false,
    wallTouched: false,
  }
  state.rotation[team] = r
  state.rotationStats[team][kind].started++
  return r
}

function endRotation(state: MatchState, team: TeamId, completed: boolean): void {
  const r = state.rotation[team]
  if (!r) return
  if (completed) state.rotationStats[team][r.kind].completed++
  // The runs end with it (a runner who did not get the ball goes back to the shape).
  for (const m of r.moves) {
    const p = state.players[m.id]!
    if ((m.job === 'run' || m.job === 'post') && state.ball.ownerId !== p.id) p.aiRunTimer = 0
  }
  state.rotation[team] = null
  state.rotationReadyAt[team] = state.time + ROTATION.cooldown
}

/** Team rotations are allowed: in possession, open play, the team's tactics allow them. */
function mayRotate(state: MatchState, team: TeamId): boolean {
  if (state.phase !== 'play' || state.possessionTeam !== team || state.clearance) return false
  if (!state.teams[team].tactics.rotations) return false
  const ph = state.teamPhase[team]
  return ph === 'attack' || ph === 'transitionAttack'
}

/** Start, advance and end rotations (once per tick, before the AI decisions). */
export function updateRotations(state: MatchState): void {
  for (const team of [0, 1] as const) {
    const r = state.rotation[team]
    if (r) {
      if (state.phase !== 'play' || state.possessionTeam !== team || state.time > r.until) {
        endRotation(state, team, false)
        continue
      }
      const owner = state.ball.ownerId
      if (r.kind === 'wallPass' && owner !== null) {
        const wall = r.moves.find((m) => m.job === 'wall')!.id
        if (owner === wall) r.wallTouched = true
        // The 1-2 is complete when the passer has it back from the wall.
        else if (owner === r.carrierId && r.wallTouched) endRotation(state, team, true)
        else if (owner !== r.carrierId) endRotation(state, team, false)
        continue
      }
      if (owner !== null && owner !== r.carrierId) {
        const m = r.moves.find((x) => x.id === owner)
        // The ball reached a runner (or the man at the post): done. The wall keeps it going.
        if (m && (m.job === 'run' || m.job === 'post' || (m.job === 'drop' && r.kind === 'pivot')))
          endRotation(state, team, true)
        else if (!m) endRotation(state, team, false)
        continue
      }
      if (r.kind === 'backPost' && !r.swapped && state.time - r.started > ROTATION.backPostSwap) {
        swapBackPost(state, team, r)
      }
      continue
    }
    if (state.time < state.rotationReadyAt[team] || !mayRotate(state, team)) continue
    // At most one starts (the first whose trigger is met).
    void (
      tryFourZero(state, team) ||
      tryBackPost(state, team) ||
      tryOverlap(state, team) ||
      tryPivot(state, team)
    )
  }
}

// ---------------------------------------------------------------------------------- helpers

function carrierOf(state: MatchState, team: TeamId): PlayerState | null {
  const id = state.ball.ownerId
  if (id === null || state.ball.inHands) return null
  const c = state.players[id]!
  return c.team === team && c.role !== 'GK' ? c : null
}

function outfield(state: MatchState, team: TeamId): PlayerState[] {
  return state.players.filter((p) => p.team === team && p.role !== 'GK')
}

/** No outfield opponent within `r` of `pos`. */
function free(state: MatchState, team: TeamId, pos: Vec2, r: number, ignoreId = -1): boolean {
  for (const o of state.players)
    if (o.team !== team && o.role !== 'GK' && o.id !== ignoreId && dist(o.pos, pos) < r) return false
  return true
}

/** No outfield opponent (other than `ignore`) within `r` of the straight path from `a` to `b`. */
function pathFree(
  state: MatchState,
  team: TeamId,
  a: Vec2,
  b: Vec2,
  r: number,
  ignore: number | readonly number[] = -1,
): boolean {
  const skip = typeof ignore === 'number' ? [ignore] : ignore
  for (const o of state.players) {
    if (o.team === team || o.role === 'GK' || skip.includes(o.id)) continue
    if (dist(closestOnSegment(a, b, o.pos).point, o.pos) < r) return false
  }
  return true
}

/** The opponent marking `q`: the nearest outfield opponent within 3.5 m (-1 if none). */
function markerOf(state: MatchState, q: PlayerState): number {
  let id = -1
  let md = 3.5
  for (const o of state.players)
    if (o.team !== q.team && o.role !== 'GK' && dist(o.pos, q.pos) < md) {
      md = dist(o.pos, q.pos)
      id = o.id
    }
  return id
}

/** Opponent outfield player closest in front of `p` (towards the goal he attacks), within range. */
function defenderInFront(state: MatchState, p: PlayerState, maxAhead: number, maxLat: number) {
  const dir = state.teams[p.team].attackDir
  let best: PlayerState | null = null
  for (const o of state.players) {
    if (o.team === p.team || o.role === 'GK') continue
    const ahead = (o.pos.y - p.pos.y) * dir
    if (ahead < 0.5 || ahead > maxAhead || Math.abs(o.pos.x - p.pos.x) > maxLat) continue
    if (!best || dist(o.pos, p.pos) < dist(best.pos, p.pos)) best = o
  }
  return best
}

/**
 * Balance: with these players gone forward, somebody else still stays behind the ball (an outfield
 * player deeper than `ballY` who is not part of the move).
 */
function balanced(state: MatchState, team: TeamId, ballY: number, busy: number[]): boolean {
  const dir = state.teams[team].attackDir
  return outfield(state, team).some((t) => !busy.includes(t.id) && (t.pos.y - ballY) * dir < -0.5)
}

// ------------------------------------------------------------------------------- wall pass

/** About how long the ball takes into the wall and back to the runner (seconds). */
const WALL_PASS_BALL_TIME = 1.2
/** The wall's marker reacts this late to the return (he is marking the man about to receive). */
const WALL_MARKER_REACTION = 0.5

/**
 * Wall pass (carrier-initiated): a defender close in front of the carrier, a free teammate 3.5-9 m
 * away to the side or a little ahead with a clear lane, and space behind the defender for the run.
 * Returns the wall and the run target, or null.
 */
export function wallPassOption(
  state: MatchState,
  p: PlayerState,
): { wall: PlayerState; run: Vec2; defender: PlayerState } | null {
  if (p.role === 'GK' || state.rotation[p.team] || !state.teams[p.team].tactics.rotations) return null
  if (state.time < state.rotationReadyAt[p.team]) return null
  const dir = state.teams[p.team].attackDir
  const goalY = dir * COURT.halfLength
  const depth = (goalY - p.pos.y) * dir
  // From midway in his own half up to the edge of the area.
  if (depth > 30 || depth < 9) return null
  const defender = defenderInFront(state, p, 4, 2.2)
  if (!defender) return null
  let best: { wall: PlayerState; run: Vec2; score: number } | null = null
  for (const w of outfield(state, p.team)) {
    if (w.id === p.id) continue
    const d = dist(w.pos, p.pos)
    const forward = (w.pos.y - p.pos.y) * dir
    if (d < 3.5 || d > 9 || forward < -2.5 || forward > 6) continue
    if (!free(state, p.team, w.pos, 1.6)) continue
    if (passInterceptable(state, p.team, p.pos, w.pos)) continue
    // The run: past the defender on the wall's side, into the space behind him.
    const side = Math.sign(w.pos.x - p.pos.x) || 1
    const run = inCourt({
      x: clamp(defender.pos.x + side * 1.8, -8.5, 8.5),
      y: defender.pos.y + dir * 3.5,
    })
    if ((goalY - run.y) * dir < 3) continue
    // Space at the end of the run (the beaten defender aside) and a clear way back from the wall.
    if (!free(state, p.team, run, 2.4, defender.id)) continue
    // He must not be beaten to it: the ball goes in and back (about a second) while he runs, and no
    // covering man may get there clearly before him (arriving together, the runner on the move wins). The wall's own marker is busy with the wall, who
    // is about to get the ball: he reacts to the return late.
    const mine = estimateTimeToReach(p, run)
    const wallMarker = markerOf(state, w)
    const beaten = state.players.some(
      (o) =>
        o.team !== p.team &&
        o.role !== 'GK' &&
        o.id !== defender.id &&
        estimateTimeToReach(o, run) + (o.id === wallMarker ? WALL_MARKER_REACTION : 0) <
          Math.max(mine, WALL_PASS_BALL_TIME) - 0.15,
    )
    if (beaten) continue
    if (passInterceptable(state, p.team, w.pos, run, 0.25, (o) => o.id === defender.id)) continue
    // Balance: somebody other than the two stays behind the ball.
    if (!balanced(state, p.team, p.pos.y, [p.id, w.id])) continue
    const score = laneOpenness(state, p.team, p.pos, w.pos) - Math.abs(d - 5.5) * 0.2
    if (!best || score > best.score) best = { wall: w, run, score }
  }
  return best ? { wall: best.wall, run: best.run, defender } : null
}

/** Start the wall pass (called by the carrier as he plays the ball into the wall). */
export function startWallPass(state: MatchState, p: PlayerState, wall: PlayerState, run: Vec2): void {
  startRotation(state, p.team, 'wallPass', p.id, [
    { id: p.id, job: 'run', target: run },
    { id: wall.id, job: 'wall', target: { ...wall.pos } },
  ])
}

/** The wall with the ball: the runner of his 1-2 (to be found first time), else null. */
export function wallPassRunner(
  state: MatchState,
  p: PlayerState,
): { runner: PlayerState; target: Vec2 } | null {
  const r = state.rotation[p.team]
  if (!r || r.kind !== 'wallPass' || state.ball.ownerId !== p.id) return null
  if (!r.moves.some((m) => m.id === p.id && m.job === 'wall')) return null
  const runner = state.players[r.carrierId]!
  const run = r.moves.find((m) => m.job === 'run')!.target
  return { runner, target: run }
}

// ---------------------------------------------------------------------------------- overlap

function tryOverlap(state: MatchState, team: TeamId): boolean {
  const c = carrierOf(state, team)
  if (!c) return false
  const dir = state.teams[team].attackDir
  const goalY = dir * COURT.halfLength
  const depth = (goalY - c.pos.y) * dir
  if (Math.abs(c.pos.x) < 4.5 || depth > 27 || depth < 8) return false
  // Held up: his marker in front of him, or he has had it a while without going forward.
  const marker = defenderInFront(state, c, 4.5, 2.5)
  if (!marker && c.aiHoldTimer < 0.8) return false
  const side = Math.sign(c.pos.x)
  // The overlapper: behind him (2-9 m) on that side of the court or the middle.
  let runner: PlayerState | null = null
  for (const t of outfield(state, team)) {
    if (t.id === c.id) continue
    const behind = (c.pos.y - t.pos.y) * dir
    if (behind < 2 || behind > 9 || t.pos.x * side < -1.5) continue
    if (!runner || dist(t.pos, c.pos) < dist(runner.pos, c.pos)) runner = t
  }
  if (!runner) return false
  const target = inCourt({ x: side * 8.2, y: c.pos.y + dir * Math.min(6.5, depth - 4) })
  const via = { x: side * 8.4, y: c.pos.y }
  // The carrier's own marker is busy with him: the run goes round the outside of him.
  const ignore = marker?.id ?? -1
  if (
    !pathFree(state, team, runner.pos, via, 1.8, ignore) ||
    !pathFree(state, team, via, target, 2.2, ignore)
  )
    return false
  if (!free(state, team, target, 2.6, ignore)) return false
  // Cover: if the overlapper was the deepest, the nearest other teammate drops into his place.
  const moves: RotationMove[] = [{ id: runner.id, job: 'run', target }]
  if (deepestOutfield(state, team) === runner.id) {
    const spot = { x: runner.pos.x * 0.4, y: runner.pos.y }
    const others = outfield(state, team).filter((t) => t.id !== c.id && t.id !== runner!.id)
    if (others.length === 0) return false
    const cover = others.reduce((a, t) => (dist(t.pos, spot) < dist(a.pos, spot) ? t : a))
    moves.push({ id: cover.id, job: 'cover', target: spot })
  } else if (!balanced(state, team, c.pos.y, [c.id, runner.id])) return false
  startRotation(state, team, 'overlap', c.id, moves)
  return true
}

// --------------------------------------------------------------------------- pivot rotation

function tryPivot(state: MatchState, team: TeamId): boolean {
  if (state.teams[team].tactics.formation !== '3-1') return false
  const c = carrierOf(state, team)
  if (!c) return false
  const dir = state.teams[team].attackDir
  const goalY = dir * COURT.halfLength
  const mates = outfield(state, team).filter((t) => t.id !== c.id)
  if (mates.length < 3) return false
  // The pivot: our most advanced player, well ahead of the ball in the attacking half.
  const pivot = mates.reduce((a, t) => ((t.pos.y - a.pos.y) * dir > 0 ? t : a))
  const ahead = (pivot.pos.y - c.pos.y) * dir
  if (ahead < 7 || pivot.pos.y * dir < 3) return false
  // Marked tight: a defender within 1.8 m of him, goal-side.
  const marked = state.players.some(
    (o) =>
      o.team !== team &&
      o.role !== 'GK' &&
      dist(o.pos, pivot.pos) < 1.8 &&
      (o.pos.y - pivot.pos.y) * dir > -0.3,
  )
  if (!marked || pressureOn(state, c) > 0.6) return false
  // The far ala: on the other side of the court from the ball, not the deepest, ahead of the ball.
  const ballSide = Math.sign(c.pos.x) || 1
  const deepest = deepestOutfield(state, team)
  const cands = mates.filter(
    (t) => t.id !== pivot.id && t.id !== deepest && t.pos.x * ballSide < 1 && (t.pos.y - c.pos.y) * dir > -3,
  )
  if (cands.length === 0) return false
  const ala = cands.reduce((a, t) => (t.pos.x * ballSide < a.pos.x * ballSide ? t : a))
  // The pivot comes short into the space in front of the ball; the ala goes where the pivot was.
  const drop = inCourt({
    x: clamp(pivot.pos.x * 0.5 + c.pos.x * 0.3, -7, 7),
    y: c.pos.y + dir * clamp(ahead * 0.45, 4.5, 7),
  })
  const runTo = inCourt({
    x: clamp(pivot.pos.x - ballSide * 1.5, -5, 5),
    y: goalY - dir * Math.max(4.5, (goalY - pivot.pos.y) * dir),
  })
  // His own marker is the one he runs away from, and the pivot's marker goes with the pivot as he
  // comes short: neither is in the way of the run.
  if (!pathFree(state, team, ala.pos, runTo, 1.5, [markerOf(state, ala), markerOf(state, pivot)]))
    return false
  if (!balanced(state, team, c.pos.y, [c.id, pivot.id, ala.id])) return false
  startRotation(state, team, 'pivot', c.id, [
    { id: pivot.id, job: 'drop', target: drop },
    { id: ala.id, job: 'run', target: runTo },
  ])
  return true
}

// ------------------------------------------------------------------------------ 4-0 rotation

function tryFourZero(state: MatchState, team: TeamId): boolean {
  if (state.teams[team].tactics.formation !== '4-0') return false
  const b = state.ball
  if (
    b.mode !== 'free' ||
    b.lastTouchTeam !== team ||
    b.intendedReceiverId === null ||
    b.lastTouchId === null
  )
    return false
  const passer = state.players[b.lastTouchId]!
  const receiver = state.players[b.intendedReceiverId]!
  if (passer.team !== team || receiver.team !== team || passer.role === 'GK' || receiver.role === 'GK')
    return false
  // From the middle out to the wing, not long ago (the ball is still near the passer's half of it).
  if (Math.abs(passer.pos.x) > 4 || Math.abs(receiver.pos.x) < 4.5) return false
  if (dist(b.pos, passer.pos) > 6) return false
  const dir = state.teams[team].attackDir
  const goalY = dir * COURT.halfLength
  const depth = (goalY - receiver.pos.y) * dir
  if (depth < 8 || depth > 32) return false
  const side = Math.sign(receiver.pos.x)
  // The passer follows his pass on the inside of the receiver and goes past him.
  const target = inCourt({ x: side * 3.6, y: receiver.pos.y + dir * Math.min(7, depth - 4.5) })
  // (His own marker goes with him: not in the way.)
  if (!pathFree(state, team, passer.pos, target, 1.6, markerOf(state, passer))) return false
  // The far ala tucks in behind into the passer's place (the back of the four).
  const others = outfield(state, team).filter((t) => t.id !== passer.id && t.id !== receiver.id)
  if (others.length === 0) return false
  const back = { x: passer.pos.x * 0.3 - side * 1.5, y: passer.pos.y - dir * 1 }
  const far = others.reduce((a, t) => (t.pos.x * side < a.pos.x * side ? t : a))
  const moves: RotationMove[] = [
    { id: passer.id, job: 'run', target },
    { id: far.id, job: 'cover', target: inCourt(back) },
  ]
  startRotation(state, team, 'fourZero', receiver.id, moves)
  return true
}

// ------------------------------------------------------------------------- back-post rotation

function backPostSpots(state: MatchState, team: TeamId, c: PlayerState) {
  const dir = state.teams[team].attackDir
  const goalY = dir * COURT.halfLength
  const side = Math.sign(c.pos.x) || 1
  return {
    back: { x: -side * 2, y: goalY - dir * 2.8 },
    top: { x: -side * 2.5, y: goalY - dir * 8 },
    front: { x: side * 0.8, y: goalY - dir * 6 },
  }
}

function tryBackPost(state: MatchState, team: TeamId): boolean {
  const c = carrierOf(state, team)
  if (!c) return false
  const dir = state.teams[team].attackDir
  const goalY = dir * COURT.halfLength
  if (Math.abs(c.pos.x) < 3 || (goalY - c.pos.y) * dir > 14) return false
  const deepest = deepestOutfield(state, team)
  const mates = outfield(state, team).filter((t) => t.id !== c.id && t.id !== deepest)
  if (mates.length < 2) return false
  const s = backPostSpots(state, team, c)
  const a = mates.reduce((x, t) => (dist(t.pos, s.back) < dist(x.pos, s.back) ? t : x))
  const rest = mates.filter((t) => t.id !== a.id)
  const b = rest.reduce((x, t) => (dist(t.pos, s.front) < dist(x.pos, s.front) ? t : x))
  if (dist(a.pos, s.back) > 14) return false
  startRotation(state, team, 'backPost', c.id, [
    { id: a.id, job: 'post', target: s.back },
    { id: b.id, job: 'run', target: s.front },
  ])
  return true
}

function swapBackPost(state: MatchState, team: TeamId, r: Rotation): void {
  const c = state.players[r.carrierId]!
  const s = backPostSpots(state, team, c)
  r.swapped = true
  // The back-post man comes out to the top of the area; the front man goes across to the back post.
  for (const m of r.moves) {
    if (m.job === 'post') {
      m.job = 'run'
      m.target = s.top
    } else if (m.job === 'run') {
      m.job = 'post'
      m.target = s.back
    }
  }
}
