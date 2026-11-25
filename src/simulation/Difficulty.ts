/**
 * Difficulty of the computer opponent (only the team not controlled by the human; AI vs AI matches
 * are unaffected). It changes decision quality, not the rules:
 * - attribute offset applied to every opponent attribute (accuracy, reactions, dribbling, keeper...),
 * - how often the opponent re-evaluates its decisions,
 * - how quickly its defenders read passes.
 */
export type Difficulty = 'easy' | 'normal' | 'hard'

export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard']

export interface DifficultyParams {
  attributeOffset: number
  decisionInterval: number
  /** Extra time (s) before a defender reads an opponent's pass. */
  readDelay: number
}

export const DIFFICULTY: Record<Difficulty, DifficultyParams> = {
  easy: { attributeOffset: -18, decisionInterval: 0.2, readDelay: 0.15 },
  normal: { attributeOffset: 0, decisionInterval: 0.1, readDelay: 0 },
  hard: { attributeOffset: 11, decisionInterval: 0.07, readDelay: -0.05 },
}

export function isDifficulty(v: unknown): v is Difficulty {
  return typeof v === 'string' && (DIFFICULTIES as readonly string[]).includes(v)
}
