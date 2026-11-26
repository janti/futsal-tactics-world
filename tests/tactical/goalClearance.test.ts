import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { MatchSimulation } from '../../src/simulation/MatchSimulation'
import { passInterceptable } from '../../src/ai/BasicAI'
import { TICK_RATE } from '../../src/simulation/SimulationConfig'

/** Team 0 (human, defends y = -20) gets a goal clearance; returns once the keeper holds the ball. */
function clearance(seed = 3) {
  const sim = new MatchSimulation({ seed, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: 0 })
  const s = sim.state
  for (let i = 0; i < 600 && !s.restart?.ready; i++) sim.step()
  sim.step([{ type: 'Pass', dir: { x: 0, y: 1 }, through: false }])
  for (let i = 0; i < 30; i++) sim.step()
  ;(
    sim as unknown as { beginRestart(t: string, team: number, spot: { x: number; y: number }): void }
  ).beginRestart('goalClearance', 0, { x: 0, y: -18.8 })
  for (let i = 0; i < TICK_RATE * 8 && !(s.phase === 'play' && s.ball.inHands); i++) sim.step()
  expect(s.clearance?.team).toBe(0)
  sim.drainEvents()
  return { sim, s, gk: sim.player(0) }
}

describe('goal clearance', () => {
  it('players not under human control stay outside the penalty area', () => {
    const { sim, s } = clearance()
    for (let i = 0; i < 20; i++) sim.step()
    const gk = sim.player(0)
    for (const p of s.players) {
      if (p.role === 'GK' || p.id === s.controlledId) continue
      expect(sim.inOwnPenaltyArea(gk, p.pos)).toBe(false)
    }
  })

  it('a throw touched inside the area is retaken', () => {
    const { sim, s } = clearance()
    // An opponent (human-like: placed there) stands inside the area where the throw goes.
    const opp = sim.player(7)
    opp.pos = { x: 0, y: -15.5 }
    sim.step([{ type: 'Throw', dir: { x: 0, y: 1 }, power: 0.2 }])
    let retaken = false
    for (let i = 0; i < TICK_RATE * 2 && !retaken; i++) {
      opp.pos = { x: 0, y: -15.5 }
      opp.vel = { x: 0, y: 0 }
      sim.step()
      if (sim.drainEvents().some((e) => e.type === 'ClearanceRetaken')) retaken = true
    }
    expect(retaken).toBe(true)
    expect(s.restart?.type).toBe('goalClearance')
    expect(s.restart?.team).toBe(0)
  })

  it('once the ball has left the area play goes on normally', () => {
    const { sim, s } = clearance()
    sim.step([{ type: 'Throw', dir: { x: 0.2, y: 1 }, power: 0.8 }])
    for (let i = 0; i < TICK_RATE * 1.2; i++) sim.step()
    expect(s.clearance).toBeNull()
    expect(s.phase === 'play' || s.phase === 'restart').toBe(true)
  })
})

describe('passing near the human player', () => {
  it('the AI rates the human-controlled player as quicker to cut a pass out than an AI player', () => {
    const sim = new MatchSimulation({ seed: 5, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: 0 })
    const s = sim.state
    for (const p of s.players) p.pos = { x: p.team === 0 ? -9 : 9, y: p.team === 0 ? -18 : 18 }
    const from = { x: -6, y: 5 }
    const to = { x: 6, y: 5 }
    // Team 0 opponent stands 3.8 m off the middle of team 1's pass line.
    const opp = s.players[2]!
    opp.pos = { x: 0, y: 8.8 }
    opp.facing = -Math.PI / 2
    s.controlledId = 3 // someone else is human-controlled
    const asAi = passInterceptable(s, 1, from, to)
    s.controlledId = 2 // now he is
    const asHuman = passInterceptable(s, 1, from, to)
    expect(asAi).toBe(false)
    expect(asHuman).toBe(true)
  })
})
