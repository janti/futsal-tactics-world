/**
 * Player-adjustable control options that affect the simulation. They are part of the match setup and
 * can be changed mid-match with a `SetControlOptions` command, so recorded command streams stay
 * deterministic.
 */

/**
 * How the controlled player is chosen while defending:
 * - `nearest`  (default): control automatically moves to the outfield player nearest the ball.
 * - `assisted`: control moves only when the opponent passes or wins the ball, to a clearly better defender.
 * - `manual`:   only the switch button changes the defending player.
 */
export type DefensiveSwitchMode = 'nearest' | 'assisted' | 'manual'

export const DEFENSIVE_SWITCH_MODES: readonly DefensiveSwitchMode[] = ['nearest', 'assisted', 'manual']

/**
 * Passing assistance for the human player:
 * - `assisted` (default): the pass snaps to the best teammate in a wide cone, leads him and is
 *   weighted automatically.
 * - `semi`: only a teammate close to the input direction is picked; slightly less accurate.
 * - `manual`: the ball goes exactly along the input direction; hold the pass button for power.
 */
export type PassAssistMode = 'assisted' | 'semi' | 'manual'

export const PASS_ASSIST_MODES: readonly PassAssistMode[] = ['assisted', 'semi', 'manual']

export interface ControlOptions {
  defensiveSwitch: DefensiveSwitchMode
  passAssist: PassAssistMode
}

export const DEFAULT_CONTROL_OPTIONS: ControlOptions = { defensiveSwitch: 'nearest', passAssist: 'assisted' }

export function isPassAssistMode(v: unknown): v is PassAssistMode {
  return typeof v === 'string' && (PASS_ASSIST_MODES as readonly string[]).includes(v)
}

export function isDefensiveSwitchMode(v: unknown): v is DefensiveSwitchMode {
  return typeof v === 'string' && (DEFENSIVE_SWITCH_MODES as readonly string[]).includes(v)
}
