import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { MatchSimulation } from '../../src/simulation/MatchSimulation'
import { twoOnKeeperMate } from '../../src/ai/BasicAI'
import type { Vec2 } from '../../src/core/math/vec2'

type Outcome = 'goal' | 'saved' | 'caught' | 'out' | 'other'

/**
 * Two on the keeper: AI carrier 6 (team 1, attacking -y) at `from`, teammate 7 at `mateAt`, every
 * team-0 outfield player 5 m behind them, against keeper 0 (defending y = -20).
 */
function twoVersusKeeper(seed: number, from: Vec2, mateAt: Vec2) {
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
    if (o.team === 0) o.pos = { x: (o.id - 2.5) * 3, y: Math.max(from.y, mateAt.y) + 5 }
    else if (o.id !== 6 && o.id !== 7) o.pos = { x: (o.id - 7.5) * 3, y: from.y + 8 }
  }
  const att = sim.player(6)
  att.pos = { ...from }
  att.vel = { x: 0, y: -3 }
  att.facing = -Math.PI / 2
  const mate = sim.player(7)
  mate.pos = { ...mateAt }
  mate.vel = { x: 0, y: -3 }
  mate.facing = -Math.PI / 2
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
  const recognised = twoOnKeeperMate(s, att)?.id === 7
  let passed = false
  for (let i = 0; i < 60 * 8; i++) {
    sim.step()
    for (const e of sim.drainEvents()) {
      if (e.type === 'PassStarted' && e.playerId === 6) passed = true
      if (e.type === 'GoalScored') return { outcome: 'goal' as Outcome, passed, recognised }
      if (e.type === 'Save')
        return { outcome: (e.caught ? 'caught' : 'saved') as Outcome, passed, recognised }
      if (e.type === 'BallOut') return { outcome: 'out' as Outcome, passed, recognised }
      if (e.type === 'PossessionChanged' && e.team === 0)
        return { outcome: 'other' as Outcome, passed, recognised }
    }
  }
  return { outcome: 'other' as Outcome, passed, recognised }
}

describe('two on the keeper (2 v 0)', () => {
  it('is recognised only when every outfield defender is behind both attackers', () => {
    const sim = new MatchSimulation({ seed: 1, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: 0 })
    const s = sim.state
    for (const o of s.players) if (o.role !== 'GK') o.pos = { x: (o.id - 5) * 2, y: 0 }
    sim.player(6).pos = { x: 2, y: -10 }
    sim.player(7).pos = { x: -3, y: -11 }
    expect(twoOnKeeperMate(s, sim.player(6))?.id).toBe(7)
    sim.player(3).pos = { x: -1, y: -11.5 }
    expect(twoOnKeeperMate(s, sim.player(6))).toBeNull()
  })

  it('the AI squares it or finishes and scores about nine times in ten', () => {
    const tally: Record<Outcome, number> = { goal: 0, saved: 0, caught: 0, out: 0, other: 0 }
    let passes = 0
    const n = 100
    for (let seed = 1; seed <= n; seed++) {
      const k = seed % 4
      const from = { x: k === 0 ? 2.5 : k === 1 ? -2.5 : k === 2 ? 0.5 : -4, y: -6 - (seed % 3) * 2 }
      const mateAt = { x: from.x > 0 ? -4 : 4, y: from.y - 0.5 + (seed % 5) * 0.5 }
      const r = twoVersusKeeper(seed, from, mateAt)
      expect(r.recognised).toBe(true)
      tally[r.outcome]++
      if (r.passed) passes++
    }
    console.log('2v0', tally, 'squared', passes)
    expect(passes).toBeGreaterThan(n * 0.4)
    expect(tally.goal).toBeGreaterThanOrEqual(n * 0.82)
    expect(tally.goal).toBeLessThanOrEqual(n * 0.97)
  })
})
