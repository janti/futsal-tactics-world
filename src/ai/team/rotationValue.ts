import { clamp } from '../../core/math/scalar'
import { dist, type Vec2 } from '../../core/math/vec2'
import type { MatchState, TeamId } from '../../simulation/MatchState'
import { COURT } from '../../simulation/SimulationConfig'

/**
 * Rough expected-goal value of an unpressured shot with a clear lane from `pos` (same curve as the
 * carrier's shotValue; kept here so the rotation modules do not import the carrier layer).
 */
export function shotValueAt(state: MatchState, team: TeamId, pos: Vec2): number {
  const goal = { x: 0, y: state.teams[team].attackDir * COURT.halfLength }
  const d = dist(pos, goal)
  const depth = Math.abs(goal.y - pos.y)
  const angle = Math.abs(pos.x) < depth * 1.6 + 1 ? 1 : 0.35
  return clamp(0.55 - (d - 4) * 0.05, 0.02, 0.55) * angle
}
