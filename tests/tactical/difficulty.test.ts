import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { MatchSimulation } from '../../src/simulation/MatchSimulation'
import { DIFFICULTY, type Difficulty } from '../../src/simulation/Difficulty'
import { TICK_RATE } from '../../src/simulation/SimulationConfig'

function sim(seed: number, difficulty: Difficulty, humanTeam: 0 | null = 0) {
  return new MatchSimulation({ seed, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam, difficulty })
}

describe('difficulty', () => {
  it('shifts only the computer opponent attributes', () => {
    const normal = sim(4, 'normal')
    for (const d of ['easy', 'hard'] as const) {
      const other = sim(4, d)
      const off = DIFFICULTY[d].attributeOffset
      // Human team unchanged.
      expect(other.player(1).profile.attributes.passing).toBe(normal.player(1).profile.attributes.passing)
      const a = normal.player(6).profile.attributes.passing
      expect(other.player(6).profile.attributes.passing).toBe(Math.min(100, Math.max(1, a + off)))
    }
  })

  it('AI vs AI matches are unaffected', () => {
    const a = sim(4, 'easy', null)
    const b = sim(4, 'hard', null)
    expect(a.player(6).profile.attributes).toEqual(b.player(6).profile.attributes)
  })

  it('a harder opponent dominates more against the same team', () => {
    // Dominance of team 1 (the computer opponent): shots for minus against, plus goal difference x3.
    const dominance = (d: Difficulty) => {
      let v = 0
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const m = sim(seed, d)
        for (let i = 0; i < TICK_RATE * 120; i++) {
          // Stand-in for the human: nobody is human-controlled, so team 0 is played by the normal AI
          // while team 1 plays at the chosen difficulty.
          m.state.controlledId = null
          m.step()
          for (const e of m.drainEvents()) {
            if (e.type === 'ShotTaken') v += e.team === 1 ? 1 : -1
            if (e.type === 'GoalScored') v += e.team === 1 ? 3 : -3
          }
        }
      }
      return v
    }
    const easy = dominance('easy')
    const hard = dominance('hard')
    console.log('difficulty dominance', { easy, hard })
    expect(easy).toBeLessThan(0)
    expect(hard).toBeGreaterThan(easy + 10)
  })
})
