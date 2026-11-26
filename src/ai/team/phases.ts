/**
 * Team phases. Every AI tick each team is in one phase, derived from the match state:
 * - `attack`: in possession, settled;
 * - `transitionAttack`: just won the ball (counter-attack window, `TRANSITION_ATTACK_TIME`);
 * - `defence`: out of possession, in shape;
 * - `transitionDefence`: just lost the ball / caught out of shape (sprint back);
 * - `setPiece`: a restart is being taken (by either team);
 * - `dead`: goal celebration, half-time, full time.
 * The phase is stored in the match state (read-only for everything but the AI) so behaviour layers and
 * debugging tools can use it.
 */
import type { MatchState, TeamId, TeamPhase } from '../../simulation/MatchState'

/** Seconds after winning the ball during which the team is in its counter-attack window. */
export const TRANSITION_ATTACK_TIME = 2.5

export function updateTeamPhases(state: MatchState): void {
  for (const team of [0, 1] as const) state.teamPhase[team] = phaseFor(state, team)
}

function phaseFor(state: MatchState, team: TeamId): TeamPhase {
  if (state.phase === 'restart') return 'setPiece'
  if (state.phase !== 'play') return 'dead'
  if (state.possessionTeam === team) {
    const since = (state.tick - state.possessionSinceTick) / 60
    return since < TRANSITION_ATTACK_TIME ? 'transitionAttack' : 'attack'
  }
  const recovering = state.players.some((p) => p.team === team && p.aiRecoverTimer > 0)
  return state.defTransition[team] || recovering ? 'transitionDefence' : 'defence'
}
