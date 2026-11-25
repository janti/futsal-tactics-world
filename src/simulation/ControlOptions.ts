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

export interface ControlOptions {
  defensiveSwitch: DefensiveSwitchMode
}

export const DEFAULT_CONTROL_OPTIONS: ControlOptions = { defensiveSwitch: 'nearest' }

export function isDefensiveSwitchMode(v: unknown): v is DefensiveSwitchMode {
  return typeof v === 'string' && (DEFENSIVE_SWITCH_MODES as readonly string[]).includes(v)
}
