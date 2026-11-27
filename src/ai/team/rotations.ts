/**
 * Attacking movement (Milestone 6). Two families share one slot per team (`state.rotation[team]`):
 *
 * **Rotations**: the continuous off-ball movement of a formation. The ball goes to a side, a player
 * moves up into space following the pattern and the receiver looks for him (or the pivot); if
 * nothing is on, the ball is moved on to a side again and the next cycle starts, and the players end
 * up back in the shape (the dynamic roles fill it from where everybody is):
 * - `baseEight`, pohjakasi (3-1): the middle man of the back three passes to a wing, runs first up
 *   the middle and then out to that wing; the wing carries the ball inside into the middle and looks
 *   for the pivot or the runner, else passes to a side (the other wing, or back to the runner) and,
 *   now the middle man, makes the run himself.
 * - `baseEightWing`, pohjakasi from the wing (3-1): a wing passes into the middle and runs diagonally
 *   up into the middle; the middle man switches the ball at once to the other wing and moves across
 *   into the wing the runner left. The far wing plays the runner (a 1-2), opens the play, or carries
 *   inside / passes on, and everybody is back in place.
 * - `butterfly`, perhonen (4-0): a central player passes to his wing, runs up through the centre and
 *   comes back out to that wing; the receiver carries inside into the central lane he left and
 *   passes to his neighbour or to a wing. Played on one side, then the other (the two wings).
 * - `fourCircle`, the 4-player rotation (4-0): a pass from one central player to the other; the
 *   passer goes out wide to keep the width and the ala on his side moves in between the lines.
 *
 * **Combinations**: two- or three-man moves where space opens: `wallPass` (1-2), `overlap`,
 * `backPost` (back post and front of the area, swapping) and `pivot` (3-1: the pivot marked tight
 * comes short and the far ala takes his place).
 *
 * Every move has named participants with a job and a target (a runner may first go via a point), a
 * trigger, a time limit and balance (one outfield player stays behind the ball). It ends completed
 * when the ball reaches a runner (a rotation also on a pass into the pivot), or is cancelled when the
 * time runs out, the ball goes to somebody outside the move, possession is lost or the ball goes dead.
 * A combination is followed by a short pause; the rotations flow on from one cycle to the next.
 */
import { clamp } from '../../core/math/scalar'
import { closestOnSegment, dist, type Vec2 } from '../../core/math/vec2'
import { laneOpenness, pressureOn } from '../../physics/PassingPhysics'
import { estimateTimeToReach } from '../../physics/PlayerPhysics'
import type { MatchState, PlayerState, TeamId } from '../../simulation/MatchState'
import { COURT } from '../../simulation/SimulationConfig'
import { deepestOutfield } from '../common'
import { passInterceptable } from '../passing'

export type PatternKind = 'baseEight' | 'baseEightWing' | 'butterfly' | 'fourCircle'
export type CombinationKind = 'wallPass' | 'overlap' | 'pivot' | 'backPost'
export type RotationKind = PatternKind | CombinationKind
export const PATTERN_KINDS: readonly PatternKind[] = ['baseEight', 'baseEightWing', 'butterfly', 'fourCircle']
export const ROTATION_KINDS: readonly RotationKind[] = [
  ...PATTERN_KINDS,
  'wallPass',
  'overlap',
  'pivot',
  'backPost',
]

/** A rotation of the formation (continuous off-ball movement), not a combination. */
export function isPattern(kind: RotationKind): kind is PatternKind {
  return (PATTERN_KINDS as readonly string[]).includes(kind)
}

/**
 * `run`: attacks space and is the one the ball should reach (its arrival completes the move);
 * `wall`: the 1-2 partner; `cover`: fills the space left behind; `drop`: comes short to show;
 * `post`: takes a spot in front of goal and strikes first time; `carry`: the receiver carries the
 * ball to the target (inside, into the middle); `switch`: the receiver plays it on at once to
 * `passTo`.
 */
export type RotationJob = 'run' | 'wall' | 'cover' | 'drop' | 'post' | 'carry' | 'switch'

export interface RotationMove {
  id: number
  job: RotationJob
  target: Vec2
  /** A runner goes this way first (e.g. up the middle before going out to the wing). */
  via?: Vec2
  viaDone?: boolean
  /** `switch`: the teammate the ball goes on to. */
  passTo?: number
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
  duration: {
    baseEight: 4.5,
    baseEightWing: 4.5,
    butterfly: 4.5,
    fourCircle: 4,
    wallPass: 2.2,
    overlap: 3,
    pivot: 2.8,
    backPost: 3.4,
  },
  /** Rotations happen between these distances (m) from the goal attacked (build-up and midcourt). */
  zone: { near: 12, far: 36 },
  /** Back-post rotation: the men swap after this long without the ball across. */
  backPostSwap: 1.5,
} as const satisfies Record<string, unknown>

export function emptyRotationStats(): Record<RotationKind, RotationStats> {
  const out = {} as Record<RotationKind, RotationStats>
  for (const k of ROTATION_KINDS) out[k] = { started: 0, completed: 0 }
  return out
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
  clearRuns(state, r)
  state.rotation[team] = null
  // A combination is followed by a pause; the rotations flow straight on into the next cycle.
  state.rotationReadyAt[team] = isPattern(r.kind) ? state.time : state.time + ROTATION.cooldown
}

/** The runs of a move end with it (a runner who did not get the ball goes back to the shape). */
function clearRuns(state: MatchState, r: Rotation): void {
  for (const m of r.moves) {
    const p = state.players[m.id]!
    if ((m.job === 'run' || m.job === 'post') && state.ball.ownerId !== p.id) p.aiRunTimer = 0
  }
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
      if (!isPattern(r.kind)) {
        advanceCombination(state, team, r)
        continue
      }
      if (advancePattern(state, team, r)) continue
      // The cycle ended with a pass: that pass may start the next cycle at once (below).
    }
    if (state.time < state.rotationReadyAt[team] || !mayRotate(state, team)) continue
    // At most one starts: the rotation the pass just made, else a combination where space opened.
    void (
      tryBaseEight(state, team) ||
      tryBaseEightWing(state, team) ||
      tryButterfly(state, team) ||
      tryFourCircle(state, team) ||
      tryBackPost(state, team) ||
      tryOverlap(state, team) ||
      tryPivot(state, team)
    )
  }
}

/** Combinations: completion, cancellation, the back-post swap. */
function advanceCombination(state: MatchState, team: TeamId, r: Rotation): void {
  const owner = state.ball.ownerId
  if (r.kind === 'wallPass' && owner !== null) {
    const wall = r.moves.find((m) => m.job === 'wall')!.id
    if (owner === wall) r.wallTouched = true
    // The 1-2 is complete when the passer has it back from the wall.
    else if (owner === r.carrierId && r.wallTouched) endRotation(state, team, true)
    else if (owner !== r.carrierId) endRotation(state, team, false)
    return
  }
  if (owner !== null && owner !== r.carrierId) {
    const m = r.moves.find((x) => x.id === owner)
    // The ball reached a runner (or the man at the post): done. The wall keeps it going.
    if (m && (m.job === 'run' || m.job === 'post' || (m.job === 'drop' && r.kind === 'pivot')))
      endRotation(state, team, true)
    else if (!m) endRotation(state, team, false)
    return
  }
  if (r.kind === 'backPost' && !r.swapped && state.time - r.started > ROTATION.backPostSwap) {
    swapBackPost(state, team, r)
  }
}

/**
 * Rotations: runners pass their via point; the carrier's pass ends the cycle (completed if it went
 * to a runner or into the pivot, otherwise the pass to a side starts the next cycle); near goal the
 * back-post combination can take over. Returns false once the rotation has ended.
 */
function advancePattern(state: MatchState, team: TeamId, r: Rotation): boolean {
  for (const m of r.moves)
    if (m.via && !m.viaDone && dist(state.players[m.id]!.pos, m.via) < 1.6) m.viaDone = true
  const b = state.ball
  const owner = b.ownerId
  const pivot = pivotOf(state, team)
  if (owner !== null && owner !== r.carrierId) {
    // Somebody else has it: a runner or the pivot (the rotation did its job), else it is over.
    const m = r.moves.find((x) => x.id === owner)
    endRotation(state, team, m?.job === 'run' || (pivot !== null && owner === pivot.id))
    return false
  }
  if (owner === null && b.mode === 'free' && b.lastTouchId === r.carrierId && b.lastTouchTeam === team) {
    const receiver = b.intendedReceiverId
    const sw = r.moves.find((m) => m.job === 'switch' && m.id === r.carrierId)
    if (sw && receiver !== null && receiver === sw.passTo) {
      // The quick switch to the far wing: he moves across into the wing the runner left, and the far
      // wing has the ball now.
      sw.job = 'cover'
      r.carrierId = receiver
      return true
    }
    // The carrier played it on: the cycle is over (a pass to a side starts the next one).
    const m = r.moves.find((x) => x.id === receiver)
    endRotation(state, team, m?.job === 'run' || (pivot !== null && receiver === pivot.id))
    return false
  }
  // The ball has come to a wing near goal: the back-post combination takes over. (Not the overlap:
  // the rotation already has a man going up the wing.)
  if (tryBackPost(state, team)) clearRuns(state, r)
  return true
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

/** The 3-1 pivot: our most advanced outfield player (null in the 4-0 / 2-2). */
function pivotOf(state: MatchState, team: TeamId): PlayerState | null {
  if (state.teams[team].tactics.formation !== '3-1') return null
  const dir = state.teams[team].attackDir
  const all = outfield(state, team)
  return all.length ? all.reduce((a, t) => ((t.pos.y - a.pos.y) * dir > 0 ? t : a)) : null
}

/**
 * The pass `team` has just played (the ball still near the passer): passer and receiver, both outfield
 * players, the receiver in the rotation zone. Null otherwise.
 */
function justPassed(state: MatchState, team: TeamId): { passer: PlayerState; receiver: PlayerState } | null {
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
  const dir = state.teams[team].attackDir
  const depth = (dir * COURT.halfLength - receiver.pos.y) * dir
  if (depth < ROTATION.zone.near || depth > ROTATION.zone.far) return null
  return { passer, receiver }
}

/** Lanes across the court: the middle (|x| under 3 m) and the wings (3.5 m and more). */
const isMiddle = (p: PlayerState) => Math.abs(p.pos.x) < 3
const isWing = (p: PlayerState) => Math.abs(p.pos.x) >= 3.5

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
  const current = state.rotation[p.team]
  // (A rotation in progress gives way to a 1-2; another combination does not.)
  if (p.role === 'GK' || (current && !isPattern(current.kind)) || !state.teams[p.team].tactics.rotations)
    return null
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
  // A rotation in progress ends here (the 1-2 is where it was going).
  if (state.rotation[p.team]) endRotation(state, p.team, false)
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
  // In the build-up a 3-1 or 4-0 team keeps its rotation going; the overlap comes further up.
  const t = state.teams[team].tactics
  const maxDepth = t.formation === '2-2' ? 27 : 22
  if (Math.abs(c.pos.x) < 4.5 || depth > maxDepth || depth < 8) return false
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

// ------------------------------------------------------------------------------- rotations

/** Pohjakasi (3-1): the middle man of the back three passes to a wing. */
function tryBaseEight(state: MatchState, team: TeamId): boolean {
  if (state.teams[team].tactics.formation !== '3-1') return false
  const pass = justPassed(state, team)
  if (!pass) return false
  const { passer, receiver } = pass
  const pivot = pivotOf(state, team)
  if (!pivot || passer.id === pivot.id || receiver.id === pivot.id) return false
  if (!isMiddle(passer) || !isWing(receiver)) return false
  const dir = state.teams[team].attackDir
  const goalY = dir * COURT.halfLength
  const side = Math.sign(receiver.pos.x)
  // First up the middle, then out to the wing he passed to, ahead of the receiver.
  const via = inCourt({ x: passer.pos.x * 0.3 + side * 0.6, y: passer.pos.y + dir * 4 })
  const ahead = Math.max(1.5, Math.min(4.5, (goalY - receiver.pos.y) * dir - 7))
  const target = inCourt({ x: side * 7.8, y: receiver.pos.y + dir * ahead })
  // The receiver carries it inside into the middle the passer left.
  const carry = inCourt({ x: side * 0.8, y: receiver.pos.y + dir * 1.5 })
  startRotation(state, team, 'baseEight', receiver.id, [
    { id: passer.id, job: 'run', target, via },
    { id: receiver.id, job: 'carry', target: carry },
  ])
  return true
}

/** Pohjakasi from the wing (3-1): a wing passes into the middle and runs up into the middle. */
function tryBaseEightWing(state: MatchState, team: TeamId): boolean {
  if (state.teams[team].tactics.formation !== '3-1') return false
  const pass = justPassed(state, team)
  if (!pass) return false
  const { passer, receiver } = pass
  const pivot = pivotOf(state, team)
  if (!pivot || passer.id === pivot.id || receiver.id === pivot.id) return false
  if (!isWing(passer) || !isMiddle(receiver)) return false
  const side = Math.sign(passer.pos.x)
  // The far wing: the third man of the base, on the other side.
  const far = outfield(state, team).find(
    (t) => t.id !== passer.id && t.id !== receiver.id && t.id !== pivot.id && t.pos.x * side < 0,
  )
  if (!far) return false
  const dir = state.teams[team].attackDir
  const goalY = dir * COURT.halfLength
  const up = Math.max(2, Math.min(6.5, (goalY - passer.pos.y) * dir - 7))
  const target = inCourt({ x: side * 1.2, y: passer.pos.y + dir * up })
  startRotation(state, team, 'baseEightWing', receiver.id, [
    { id: passer.id, job: 'run', target },
    // Switches it to the far wing at once, then moves across into the wing the runner left.
    { id: receiver.id, job: 'switch', target: { ...passer.pos }, passTo: far.id },
  ])
  return true
}

/** Perhonen (4-0): a central player passes to his wing. */
function tryButterfly(state: MatchState, team: TeamId): boolean {
  if (state.teams[team].tactics.formation !== '4-0') return false
  const pass = justPassed(state, team)
  if (!pass) return false
  const { passer, receiver } = pass
  if (Math.abs(passer.pos.x) >= 4 || Math.abs(receiver.pos.x) < 4.5) return false
  const side = Math.sign(receiver.pos.x)
  // His own wing (or from the very middle either side).
  if (passer.pos.x * side < -1) return false
  const dir = state.teams[team].attackDir
  const goalY = dir * COURT.halfLength
  // Up through the centre, then back out to the wing he passed to.
  const up = Math.max(2, Math.min(5, (goalY - passer.pos.y) * dir - 8))
  const via = inCourt({ x: passer.pos.x * 0.2, y: passer.pos.y + dir * up })
  const target = inCourt({ x: side * 7.6, y: receiver.pos.y + dir * 1.5 })
  // The receiver carries it inside into the central lane he left.
  const carry = inCourt({ x: side * 2.2, y: passer.pos.y + dir * 0.5 })
  startRotation(state, team, 'butterfly', receiver.id, [
    { id: passer.id, job: 'run', target, via },
    { id: receiver.id, job: 'carry', target: carry },
  ])
  return true
}

/** The 4-player rotation (4-0): one central player passes to the other. */
function tryFourCircle(state: MatchState, team: TeamId): boolean {
  if (state.teams[team].tactics.formation !== '4-0') return false
  const pass = justPassed(state, team)
  if (!pass) return false
  const { passer, receiver } = pass
  if (Math.abs(passer.pos.x) >= 4 || Math.abs(receiver.pos.x) >= 4) return false
  if (Math.abs(passer.pos.x - receiver.pos.x) < 2.5) return false
  const sideP = Math.sign(passer.pos.x - receiver.pos.x) || 1
  // The ala on the passer's side (away from the ball) moves in between the lines; the passer goes out
  // to his wing to keep the width.
  const ala = outfield(state, team).find(
    (t) => t.id !== passer.id && t.id !== receiver.id && t.pos.x * sideP > 3.5,
  )
  if (!ala) return false
  const dir = state.teams[team].attackDir
  const goalY = dir * COURT.halfLength
  const up = Math.max(2, Math.min(6.5, (goalY - receiver.pos.y) * dir - 6))
  startRotation(state, team, 'fourCircle', receiver.id, [
    { id: ala.id, job: 'run', target: inCourt({ x: sideP * 2.4, y: receiver.pos.y + dir * up }) },
    { id: passer.id, job: 'cover', target: inCourt({ x: sideP * 7.4, y: passer.pos.y + dir * 0.5 }) },
  ])
  return true
}

/**
 * The pass that keeps a rotation going, for a carrier in the rotation zone with nothing better on:
 * the 3-1 middle man to a wing (pohjakasi), a 3-1 wing into the middle (pohjakasi from the wing), a
 * 4-0 central player to his wing (perhonen) or to the other central player (4-player rotation), a 4-0
 * wing back to a central player. The most open safe target, or null.
 */
export function rotationPassTarget(state: MatchState, p: PlayerState): PlayerState | null {
  const team = p.team
  const t = state.teams[team].tactics
  if (!t.rotations || (t.formation !== '3-1' && t.formation !== '4-0') || p.role === 'GK') return null
  const r = state.rotation[team]
  if (r && (!isPattern(r.kind) || r.carrierId !== p.id)) return null
  const dir = state.teams[team].attackDir
  const depth = (dir * COURT.halfLength - p.pos.y) * dir
  if (depth < ROTATION.zone.near || depth > ROTATION.zone.far) return null
  const pivot = pivotOf(state, team)
  if (pivot && p.id === pivot.id) return null
  let best: PlayerState | null = null
  let bestScore = -Infinity
  for (const q of outfield(state, team)) {
    if (q.id === p.id || (pivot && q.id === pivot.id)) continue
    if (Math.abs(q.pos.y - p.pos.y) > 9 || dist(q.pos, p.pos) < 3) continue
    if (t.formation === '3-1') {
      if (isMiddle(p) ? !isWing(q) : !isMiddle(q)) continue
    } else if (Math.abs(p.pos.x) < 4) {
      // A 4-0 central player: his own wing (perhonen) or the other central man (4-player rotation).
      if (Math.abs(q.pos.x) >= 4.5 && q.pos.x * p.pos.x < -1) continue
    } else if (Math.abs(q.pos.x) >= 4) continue
    // An easy ball: to a free man (nobody within 2.5 m), a clear lane, safe from interception,
    // preferably short.
    if (!free(state, team, q.pos, 2.5) || passInterceptable(state, team, p.pos, q.pos)) continue
    const lane = laneOpenness(state, team, p.pos, q.pos)
    if (lane < 1) continue
    const score = Math.min(lane, 3) - Math.abs(dist(q.pos, p.pos) - 8) * 0.08
    if (score > bestScore) {
      bestScore = score
      best = q
    }
  }
  return best
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
