/**
 * Team tactics (Milestone 6). Part of the match state, so they are deterministic, can be changed by a
 * command during the match and are read by the AI every tick.
 */

/**
 * Attacking formation (outfield players; the keeper is not counted):
 * - `3-1`: fixo at the back, two alas, a pivot up front (the classic diamond).
 * - `4-0`: four in a line across the court, no fixed pivot; the space in behind is attacked by runs.
 * - `2-2`: two at the back, two up front (a box).
 */
export type Formation = '3-1' | '4-0' | '2-2'

/**
 * How high the team defends:
 * - `low`: a low block round the own penalty area; the press starts only near goal.
 * - `mid`: the default mid-block; the press engages from about the halfway line.
 * - `high`: pressing high up the court, tight on the carrier everywhere.
 */
export type PressingHeight = 'low' | 'mid' | 'high'

export interface TeamTactics {
  formation: Formation
  pressing: PressingHeight
}

export const FORMATIONS: readonly Formation[] = ['3-1', '4-0', '2-2']
export const PRESSING_HEIGHTS: readonly PressingHeight[] = ['low', 'mid', 'high']

export const DEFAULT_TACTICS: TeamTactics = { formation: '3-1', pressing: 'mid' }

/** Pressing parameters per height. */
export const PRESSING = {
  /**
   * The carrier is pressed tightly (engaged) within this distance of the defending team's goal;
   * further out the presser stands off on the inside.
   */
  engageDistance: { low: 15, mid: 22, high: 40 },
  /** Highest point of the defensive block (top of the diamond), as team-relative depth 0..1. */
  blockTop: { low: 0.42, mid: 0.68, high: 0.82 },
  /** Lowest point of the top of the block. */
  blockFloor: { low: 0.2, mid: 0.2, high: 0.3 },
  /** How far behind the ball the top of the block sits (team-relative depth): a high press sits closer. */
  blockGap: { low: 0.12, mid: 0.1, high: 0.04 },
} as const satisfies Record<string, Record<PressingHeight, number>>
