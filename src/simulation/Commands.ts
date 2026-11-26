import type { Vec2 } from '../core/math/vec2'
import type { ControlOptions } from './ControlOptions'
import type { TeamId } from './MatchState'
import type { TeamTactics } from './Tactics'

/**
 * Typed commands sent into the authoritative simulation. A recorded list of commands per tick
 * fully reproduces a match given the same seed (see tests/integration/determinism.test.ts).
 * Directions are already in simulation space (screen-relative mapping happens in the input layer).
 */
export type Command =
  /** `aimOnly`: turn to face `dir` without moving (keeper aiming a throw). */
  | { type: 'Move'; dir: Vec2; sprint: boolean; sole: boolean; aimOnly?: boolean }
  /** Goalkeeper throw from the hands: direction and power (0..1) chosen by the player. */
  | { type: 'Throw'; dir: Vec2; power: number }
  /** `power` (0..1): manual passing only (hold the button for a harder pass). */
  /**
   * Pass along the floor (`power` 0..1 from how long the button was held), or with `chip` a lofted
   * ball whose height and length come from `power`.
   */
  | { type: 'Pass'; dir: Vec2; through: boolean; power?: number; chip?: boolean }
  | { type: 'Shoot'; dir: Vec2; power: number }
  | { type: 'Tackle' }
  | { type: 'SwitchPlayer'; dir: Vec2 }
  | { type: 'SetControlOptions'; options: Partial<ControlOptions> }
  /** Change a team's tactics during the match (formation, pressing). */
  | { type: 'SetTactics'; team: TeamId; tactics: Partial<TeamTactics> }
