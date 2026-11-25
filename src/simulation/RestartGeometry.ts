import type { Vec2 } from '../core/math/vec2'
import type { MatchState, RestartInfo } from './MatchState'
import { COURT } from './SimulationConfig'

/** How far behind the ball the taker of a kick-in or corner stands (metres). */
export const TAKER_BEHIND = 0.5
/** Kick-off: the taker stands this far behind the ball. */
export const KICKOFF_BEHIND = 0.35
/** Kick-ins must be played into the court: minimum component of the aim across the touch line. */
const KICK_IN_MIN_INWARD = 0.15

/**
 * Direction pointing into the court from a restart spot: kick-ins face across the court, corners
 * diagonally into the court, the kick-off towards the opponent half.
 */
export function restartInward(state: MatchState, r: Pick<RestartInfo, 'type' | 'spot' | 'team'>): Vec2 {
  if (r.type === 'kickIn') return { x: -Math.sign(r.spot.x) || 1, y: 0 }
  if (r.type === 'corner') {
    const k = Math.SQRT1_2
    return { x: -Math.sign(r.spot.x) * k, y: -Math.sign(r.spot.y) * k }
  }
  return { x: 0, y: state.teams[r.team].attackDir }
}

/**
 * Keep an aim direction legal for the restart: kick-ins and corners must be played into the court
 * (a corner may go anywhere into the court quarter, a kick-in anywhere except back over the line);
 * the kick-off can go in any direction.
 */
export function clampRestartAim(
  state: MatchState,
  r: Pick<RestartInfo, 'type' | 'spot' | 'team'>,
  dir: Vec2,
): Vec2 {
  const l = Math.hypot(dir.x, dir.y)
  if (l < 1e-6) return restartInward(state, r)
  let x = dir.x / l
  let y = dir.y / l
  if (r.type === 'kickIn') {
    const inX = -Math.sign(r.spot.x) || 1
    if (x * inX < KICK_IN_MIN_INWARD) {
      x = inX * KICK_IN_MIN_INWARD
      y = Math.sign(y || 1) * Math.sqrt(1 - KICK_IN_MIN_INWARD * KICK_IN_MIN_INWARD)
    }
  } else if (r.type === 'corner') {
    const inX = -Math.sign(r.spot.x)
    const inY = -Math.sign(r.spot.y)
    if (x * inX < 0.05) x = inX * 0.05
    if (y * inY < 0.05) y = inY * 0.05
    const n = Math.hypot(x, y)
    x /= n
    y /= n
  }
  return { x, y }
}

/**
 * Where the taker stands: behind the ball along the aim direction, so the ball is always in front of
 * him on the line (or on the centre spot). At a goal clearance the keeper gathers the ball itself.
 */
export function restartTakerSpot(state: MatchState, r: RestartInfo): Vec2 {
  if (r.type === 'goalClearance') return { ...r.spot }
  const aim = r.aimDir ?? restartInward(state, r)
  const back = r.type === 'kickoff' ? KICKOFF_BEHIND : TAKER_BEHIND
  const p = { x: r.spot.x - aim.x * back, y: r.spot.y - aim.y * back }
  // Stay within the run-off area.
  const bx = COURT.halfWidth + COURT.runOff - 0.05
  const by = COURT.halfLength + COURT.runOff - 0.05
  return { x: Math.max(-bx, Math.min(bx, p.x)), y: Math.max(-by, Math.min(by, p.y)) }
}
