/**
 * Match format. Official futsal: two 20-minute halves of effective playing time (the clock stops
 * whenever the ball is dead). Arcade lengths are shorter; a running clock is available as an option.
 */
export interface MatchRules {
  /** Length of one half in seconds of match clock. */
  halfLength: number
  /** Effective time (clock stops when the ball is dead) or a running clock. */
  effectiveClock: boolean
  /** Length of the half-time break in the simulation (seconds of presentation). */
  halftimeBreak: number
}

/** Arcade half lengths offered in the Quick Match menu (minutes). */
export const HALF_LENGTH_OPTIONS = [2, 3, 5, 10, 20] as const
export type HalfLengthMinutes = (typeof HALF_LENGTH_OPTIONS)[number]

export const DEFAULT_RULES: MatchRules = { halfLength: 3 * 60, effectiveClock: true, halftimeBreak: 3 }

export interface TeamStats {
  goals: number
  shots: number
  shotsOnTarget: number
  passes: number
  passesCompleted: number
  saves: number
  corners: number
  kickIns: number
  /** Ticks in possession during open play (for the possession percentage). */
  possessionTicks: number
}

export function emptyStats(): TeamStats {
  return {
    goals: 0,
    shots: 0,
    shotsOnTarget: 0,
    passes: 0,
    passesCompleted: 0,
    saves: 0,
    corners: 0,
    kickIns: 0,
    possessionTicks: 0,
  }
}
