/**
 * Shared geometry and team helpers for the rotation library (planners, selection, runtime). All
 * read only observable state: positions, velocities, the ball.
 */
import { clamp } from '../../core/math/scalar'
import { closestOnSegment, dist, type Vec2 } from '../../core/math/vec2'
import type { MatchState, PlayerState, TeamId } from '../../simulation/MatchState'
import { COURT } from '../../simulation/SimulationConfig'
import { DEFAULT_STYLE, s01, type RotationStyle } from './rotationLibrary'

export const inCourt = (v: Vec2): Vec2 => ({
  x: clamp(v.x, -COURT.halfWidth + 0.8, COURT.halfWidth - 0.8),
  y: clamp(v.y, -COURT.halfLength + 1.2, COURT.halfLength - 1.2),
})

export function styleOf(state: MatchState, team: TeamId): RotationStyle {
  return state.teams[team].tactics.style ?? DEFAULT_STYLE
}

/** The team's outfield carrier (null when the ball is loose, with the keeper or the other team). */
export function carrierOf(state: MatchState, team: TeamId): PlayerState | null {
  const id = state.ball.ownerId
  if (id === null || state.ball.inHands) return null
  const c = state.players[id]!
  return c.team === team && c.role !== 'GK' ? c : null
}

export function outfield(state: MatchState, team: TeamId): PlayerState[] {
  return state.players.filter((p) => p.team === team && p.role !== 'GK')
}

/** Outfield teammates the AI may move (never the human-controlled player). */
export function movable(state: MatchState, team: TeamId): PlayerState[] {
  return state.players.filter((p) => p.team === team && p.role !== 'GK' && p.id !== state.controlledId)
}

export const attackDir = (state: MatchState, team: TeamId): 1 | -1 => state.teams[team].attackDir
export const goalYOf = (state: MatchState, team: TeamId): number => attackDir(state, team) * COURT.halfLength

/** Distance (m) from `pos` to the goal `team` attacks, along the length of the court. */
export function depthToGoal(state: MatchState, team: TeamId, pos: Vec2): number {
  const dir = attackDir(state, team)
  return (dir * COURT.halfLength - pos.y) * dir
}

/** The 3-1 pivot: our most advanced outfield player (null in the 4-0 / 2-2). */
export function pivotOf(state: MatchState, team: TeamId): PlayerState | null {
  if (state.teams[team].tactics.formation !== '3-1') return null
  return mostAdvanced(state, team)
}

export function mostAdvanced(state: MatchState, team: TeamId, exclude = -1): PlayerState | null {
  const dir = attackDir(state, team)
  const all = outfield(state, team).filter((p) => p.id !== exclude)
  return all.length ? all.reduce((a, t) => ((t.pos.y - a.pos.y) * dir > 0 ? t : a)) : null
}

/** Lanes across the court: the middle (|x| under 3 m) and the wings (3.5 m and more). */
export const isMiddle = (p: PlayerState): boolean => Math.abs(p.pos.x) < 3
export const isWing = (p: PlayerState): boolean => Math.abs(p.pos.x) >= 3.5

/** No outfield opponent within `r` of `pos`. */
export function free(state: MatchState, team: TeamId, pos: Vec2, r: number, ignoreId = -1): boolean {
  for (const o of state.players)
    if (o.team !== team && o.role !== 'GK' && o.id !== ignoreId && dist(o.pos, pos) < r) return false
  return true
}

/** Distance from `pos` to the nearest outfield opponent. */
export function spaceAt(state: MatchState, team: TeamId, pos: Vec2, ignoreId = -1): number {
  let d = Infinity
  for (const o of state.players)
    if (o.team !== team && o.role !== 'GK' && o.id !== ignoreId) d = Math.min(d, dist(o.pos, pos))
  return d
}

/** No outfield opponent (other than `ignore`) within `r` of the straight path from `a` to `b`. */
export function pathFree(
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
export function markerOf(state: MatchState, q: PlayerState, within = 3.5): number {
  let id = -1
  let md = within
  for (const o of state.players)
    if (o.team !== q.team && o.role !== 'GK' && dist(o.pos, q.pos) < md) {
      md = dist(o.pos, q.pos)
      id = o.id
    }
  return id
}

/** Opponent outfield player closest in front of `p` (towards the goal he attacks), within range. */
export function defenderInFront(
  state: MatchState,
  p: PlayerState,
  maxAhead: number,
  maxLat: number,
): PlayerState | null {
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

/** The deepest outfield player of `team` (towards his own goal), optionally among `ids` only. */
export function deepestOf(state: MatchState, team: TeamId, skip: readonly number[] = []): PlayerState | null {
  const dir = attackDir(state, team)
  let best: PlayerState | null = null
  for (const p of outfield(state, team)) {
    if (skip.includes(p.id)) continue
    if (!best || (p.pos.y - best.pos.y) * dir < 0) best = p
  }
  return best
}

/**
 * Rest defence (0..1) if the players in `busy` go forward: outfield players not in the move level
 * with the ball or behind it (one 0.6, two 1), a little more with one of them central, less for
 * every opponent already ahead of the ball and goal-side of our last man (a counter threat).
 */
export function balanceScore(
  state: MatchState,
  team: TeamId,
  ballY: number,
  busy: readonly number[],
  threats = true,
): number {
  const dir = attackDir(state, team)
  const behind = outfield(state, team).filter((t) => !busy.includes(t.id) && (t.pos.y - ballY) * dir < -0.5)
  let score = behind.length >= 2 ? 1 : behind.length === 1 ? 0.6 : 0
  if (behind.some((t) => Math.abs(t.pos.x) < 5)) score += 0.1
  if (!threats) return clamp(score, 0, 1)
  const last = behind.length ? Math.min(...behind.map((t) => t.pos.y * dir)) : ballY * dir
  for (const o of state.players)
    if (o.team !== team && o.role !== 'GK' && o.pos.y * dir < last - 1) score -= 0.25
  return clamp(score, 0, 1)
}

/**
 * The rest defence the team requires for a move (0..1): one man behind the ball at the default
 * setting (0.6); more with a high balance setting, less when chasing the game late on.
 */
export function requiredBalance(state: MatchState, team: TeamId): number {
  const st = styleOf(state, team)
  let req = 0.35 + s01(st.balance) * 0.45 + (s01(st.discipline) - 0.5) * 0.1
  const opp = (1 - team) as TeamId
  const behindBy = state.score[opp] - state.score[team]
  const late = matchProgress(state) > 0.8
  if (behindBy > 0 && late) req -= 0.2
  return clamp(req, 0.2, 0.95)
}

/** Balance is enough for a move with these players busy going forward. */
export function balanceOk(state: MatchState, team: TeamId, ballY: number, busy: readonly number[]): boolean {
  // Structural: who stays behind the ball (the counter threat weighs in the selection's cost).
  return balanceScore(state, team, ballY, busy, false) >= requiredBalance(state, team) - 1e-6
}

/** 0 at kick-off, 1 at full time. */
export function matchProgress(state: MatchState): number {
  const half = state.rules.halfLength
  if (!(half > 0)) return 0
  const total = half * 2
  const elapsed = (state.half - 1) * half + (half - state.clock)
  return clamp(elapsed / total, 0, 1)
}
