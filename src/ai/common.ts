/** Shared AI helpers and constants (difficulty, team geometry queries, shooting lanes). */
import { clamp } from '../core/math/scalar'
import { closestOnSegment, dist, len, sub, type Vec2 } from '../core/math/vec2'
import type { MatchState, PlayerState, TeamId } from '../simulation/MatchState'
import { COURT, POST_X } from '../simulation/SimulationConfig'
import { baseAnchor } from './positioning/Formation'
import { DIFFICULTY, type DifficultyParams } from '../simulation/Difficulty'

export interface AIActions {
  /** `arrival`: wanted ball speed at the receiver (default: a normal pass). */
  pass(
    p: PlayerState,
    dir: Vec2,
    through: boolean,
    receiver: PlayerState | null,
    power?: number,
    arrival?: number,
  ): void
  shoot(p: PlayerState, dir: Vec2, power: number): void
  /** Goalkeeper throw from the hands (same throw a human keeper makes). */
  throwBall(p: PlayerState, dir: Vec2, power: number): void
}

/** Metres the alas drop towards their own goal at the team's goal clearances. */
export const GOAL_CLEARANCE_ALA_DROP = 1

/** Seconds of immediate sprinting back into shape after losing the ball. */
export const RECOVER_TIME = 1.6

/** Beyond this distance from our goal the presser contains (stands off) instead of engaging. */
export const PRESS_ENGAGE_DISTANCE = 22

/**
 * Goal clearance: players not under human control keep out of the clearing team's penalty area.
 * Returns `pos`, or the nearest point just outside the area.
 */
export function outsideClearanceArea(state: MatchState, pos: Vec2, team?: TeamId): Vec2 {
  const clTeam = team ?? state.clearance?.team
  if (clTeam === undefined) return pos
  const dir = state.teams[clTeam].attackDir
  const goalY = -dir * COURT.halfLength
  const r = COURT.penaltyAreaRadius + 0.7
  const depth = (pos.y - goalY) * dir
  const ax = Math.abs(pos.x)
  const inside = ax <= POST_X ? depth <= r : Math.hypot(ax - POST_X, Math.max(0, depth)) <= r
  if (!inside) return pos
  if (ax <= POST_X) return { x: pos.x, y: goalY + dir * r }
  const c = { x: Math.sign(pos.x) * POST_X, y: goalY }
  const off = { x: pos.x - c.x, y: Math.max(0.1, depth) * dir }
  const l = Math.hypot(off.x, off.y)
  return { x: c.x + (off.x / l) * r, y: c.y + (off.y / l) * r }
}

export function difficultyFor(state: MatchState, team: TeamId): DifficultyParams {
  return state.humanTeam !== null && team !== state.humanTeam
    ? DIFFICULTY[state.difficulty]
    : DIFFICULTY.normal
}

export function kickoffAnchor(state: MatchState, p: PlayerState): Vec2 {
  const own = state.restart?.type === 'kickoff' ? state.restart.team === p.team : false
  return baseAnchor(p.role, own ? 'kickoffOwn' : 'kickoffOpp', state.teams[p.team].attackDir)
}

/** The deepest outfield player of a team (stays as cover; makes no forward runs). */
export function deepestOutfield(state: MatchState, team: TeamId): number | null {
  const dir = state.teams[team].attackDir
  let best: PlayerState | null = null
  for (const t of state.players)
    if (t.team === team && t.role !== 'GK' && (!best || t.pos.y * dir < best.pos.y * dir)) best = t
  return best ? best.id : null
}

/** The deepest outfield player of his team (the last man): he does not take players on. */
export function isLastMan(state: MatchState, p: PlayerState): boolean {
  const dir = state.teams[p.team].attackDir
  for (const t of state.players)
    if (t.team === p.team && t.role !== 'GK' && t.id !== p.id && t.pos.y * dir < p.pos.y * dir) return false
  return true
}

/** No opponent within `range` metres in a 60-degree cone ahead of the player. */
export function spaceAhead(state: MatchState, p: PlayerState, heading: Vec2, range: number): boolean {
  for (const o of state.players) {
    if (o.team === p.team) continue
    const to = sub(o.pos, p.pos)
    const d = len(to)
    if (d > range) continue
    if (to.x * heading.x + to.y * heading.y > d * 0.5) return false
  }
  return true
}

/** How dangerous a position is for scoring: close to goal with a shooting angle (0..1). */
export function scoringValue(state: MatchState, team: number, pos: Vec2): number {
  const dir = state.teams[team as 0 | 1].attackDir
  const goal = { x: 0, y: dir * COURT.halfLength }
  const d = dist(pos, goal)
  const depthToLine = Math.abs(goal.y - pos.y)
  const angle = Math.abs(pos.x) < depthToLine * 1.6 + 1 ? 1 : 0.3
  return clamp((16 - d) / 10, 0, 1) * angle
}

/**
 * Openness of the best shooting lane: towards either corner of the goal, ignoring the goalkeeper
 * (who always stands on the line; beating him is the shot's job). Outfield blockers count.
 */
export function shootingLane(state: MatchState, p: PlayerState, goalY: number): number {
  let best = -Infinity
  for (const cx of [-1.15, 1.15]) {
    const target = { x: cx, y: goalY }
    let open = Infinity
    for (const o of state.players) {
      if (o.team === p.team || o.role === 'GK') continue
      const { point, t } = closestOnSegment(p.pos, target, o.pos)
      open = Math.min(open, dist(point, o.pos) - t * 0.3)
    }
    best = Math.max(best, open)
  }
  return best
}
