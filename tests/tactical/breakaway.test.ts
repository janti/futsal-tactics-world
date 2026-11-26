import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { MatchSimulation } from '../../src/simulation/MatchSimulation'
import { isBreakaway } from '../../src/ai/BasicAI'
import type { Vec2 } from '../../src/core/math/vec2'

type Outcome = 'goal' | 'saved' | 'caught' | 'out' | 'other'

/**
 * AI attacker (id 6, team 1, attacking -y) gets the ball at `from` with every team-0 outfield player
 * behind him: through on goal against keeper 0 (defending y = -20).
 */
function breakaway(seed: number, from: Vec2): { outcome: Outcome; shotDist: number; passed: boolean } {
  const sim = new MatchSimulation({ seed, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: 0 })
  const s = sim.state
  for (let i = 0; i < 600 && !s.restart?.ready; i++) sim.step()
  sim.step([{ type: 'Pass', dir: { x: 0, y: 1 }, through: false }])
  for (let i = 0; i < 30; i++) sim.step()
  s.phase = 'play'
  s.restart = null
  for (const o of s.players) {
    o.vel = { x: 0, y: 0 }
    if (o.role === 'GK') continue
    if (o.team === 0) o.pos = { x: (o.id - 2.5) * 3, y: from.y + 4 }
    else if (o.id !== 6) o.pos = { x: (o.id - 7.5) * 3, y: from.y + 6 }
  }
  const att = sim.player(6)
  att.pos = { ...from }
  att.facing = -Math.PI / 2
  s.ball.ownerId = 6
  s.ball.mode = 'controlled'
  s.ball.inHands = false
  s.ball.pos = { x: from.x, y: from.y - 0.4 }
  s.ball.z = 0
  s.ball.vel = { x: 0, y: 0 }
  s.ball.lastTouchTeam = 1
  s.ball.lastTouchId = 6
  s.possessionTeam = 1
  sim.drainEvents()
  let shotDist = -1
  let passed = false
  for (let i = 0; i < 60 * 8; i++) {
    sim.step()
    for (const e of sim.drainEvents()) {
      if (e.type === 'ShotTaken') shotDist = Math.hypot(att.pos.x, att.pos.y + 20)
      if (e.type === 'PassStarted' && e.playerId === 6) passed = true
      if (e.type === 'GoalScored') return { outcome: 'goal', shotDist, passed }
      if (e.type === 'Save') return { outcome: e.caught ? 'caught' : 'saved', shotDist, passed }
      if (e.type === 'BallOut') return { outcome: 'out', shotDist, passed }
      if (e.type === 'PossessionChanged' && e.team === 0) return { outcome: 'other', shotDist, passed }
    }
  }
  return { outcome: 'other', shotDist, passed }
}

describe('breakaway (through on goal)', () => {
  it('is recognised only with no defender goal-side of the carrier', () => {
    const sim = new MatchSimulation({ seed: 1, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: 0 })
    const s = sim.state
    const att = sim.player(6)
    att.pos = { x: 0, y: -8 }
    for (const o of s.players) if (o.team === 0 && o.role !== 'GK') o.pos = { x: o.id * 2, y: -3 }
    expect(isBreakaway(s, att, { x: 0, y: -20 })).toBe(true)
    sim.player(2).pos = { x: 0.5, y: -13 }
    expect(isBreakaway(s, att, { x: 0, y: -20 })).toBe(false)
  })

  it('the AI takes the ball in close and scores more often than not, keeper sometimes saves', () => {
    const tally: Record<Outcome, number> = { goal: 0, saved: 0, caught: 0, out: 0, other: 0 }
    const dists: number[] = []
    let passes = 0
    const n = 40
    for (let seed = 1; seed <= n; seed++) {
      const r = breakaway(seed, { x: seed % 3 === 0 ? -3 : seed % 3 === 1 ? 3 : 0, y: -2 })
      tally[r.outcome]++
      if (r.shotDist > 0) dists.push(r.shotDist)
      if (r.passed) passes++
    }
    console.log('breakaway', tally, 'mean shot distance', dists.reduce((a, b) => a + b, 0) / dists.length)
    // Through on goal he finishes himself; only rarely, when a recovering defender gets goal-side, he passes.
    expect(passes).toBeLessThanOrEqual(2)
    expect(dists.length).toBeGreaterThan(n * 0.8)
    for (const d of dists) expect(d).toBeLessThan(10.5)
    expect(tally.goal).toBeGreaterThan(n * 0.45)
    expect(tally.goal).toBeLessThan(n * 0.85)
    expect(tally.saved + tally.caught).toBeGreaterThan(n * 0.1)
  })
})
