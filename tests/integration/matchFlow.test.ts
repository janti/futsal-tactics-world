import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { MatchSimulation } from '../../src/simulation/MatchSimulation'
import type { MatchEvent } from '../../src/simulation/Events'
import { COURT, TICK_RATE } from '../../src/simulation/SimulationConfig'

function runAiMatch(seed: number, seconds: number) {
  const sim = new MatchSimulation({ seed, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: null })
  const counts: Record<string, number> = {}
  let maxPressers = 0
  const all: MatchEvent[] = []
  for (let i = 0; i < seconds * TICK_RATE; i++) {
    sim.step()
    for (const e of sim.drainEvents()) {
      counts[e.type] = (counts[e.type] ?? 0) + 1
      all.push(e)
    }
    for (const team of [0, 1]) {
      const n = sim.state.players.filter(
        (p) => p.team === team && (p.aiState === 'press' || p.aiState === 'chase'),
      ).length
      maxPressers = Math.max(maxPressers, n)
    }
  }
  return { sim, counts, maxPressers, all }
}

describe('AI vs AI match flow (headless)', () => {
  it('plays a lively match: passes, shots, restarts and goals happen', () => {
    const { sim, counts } = runAiMatch(7, 300)
    expect(counts.PassStarted ?? 0).toBeGreaterThan(40)
    expect(counts.PassCompleted ?? 0).toBeGreaterThan(15)
    expect(counts.ShotTaken ?? 0).toBeGreaterThan(4)
    expect(sim.state.playingTime).toBeGreaterThan(120)
    // Players stay inside the run-off area and the ball stays finite.
    for (const p of sim.state.players) {
      expect(Math.abs(p.pos.x)).toBeLessThanOrEqual(COURT.halfWidth + COURT.runOff + 1e-6)
      expect(Math.abs(p.pos.y)).toBeLessThanOrEqual(COURT.halfLength + COURT.runOff + 1e-6)
    }
    expect(Number.isFinite(sim.state.ball.pos.x)).toBe(true)
  })

  it('never sends more than one player per team to the ball (anti-ball-chasing)', () => {
    const { maxPressers } = runAiMatch(11, 120)
    expect(maxPressers).toBeLessThanOrEqual(1)
  })

  it('scores goals across several seeds', () => {
    let goals = 0
    for (const seed of [1, 2, 3]) goals += runAiMatch(seed, 240).counts.GoalScored ?? 0
    expect(goals).toBeGreaterThan(0)
  })
})
