import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { MatchSimulation } from '../../src/simulation/MatchSimulation'
import { COURT, TICK_RATE } from '../../src/simulation/SimulationConfig'

function newSim(seed: number, humanTeam: 0 | null = 0) {
  return new MatchSimulation({ seed, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam })
}

type Outcome = 'goal' | 'saved' | 'out' | 'other'

/**
 * Shot scenario: the controlled attacker (team 0, attacking +y) shoots from (x, fromY) with the
 * keeper settled and every other outfield player out of the way on the touch lines.
 */
function shotOutcome(seed: number, fromY: number, x: number, power: number, aimX: number): Outcome {
  const sim = newSim(seed)
  const s = sim.state
  for (let i = 0; i < 600 && !s.restart?.ready; i++) sim.step()
  sim.step([{ type: 'Pass', dir: { x: 0, y: -1 }, through: false }])
  for (let i = 0; i < 120; i++) sim.step()
  const p = sim.player(4)
  s.controlledId = 4
  const park = () => {
    for (const o of s.players)
      if (o.id !== 4 && o.role !== 'GK') o.pos = { x: o.id % 2 ? 9.5 : -9.5, y: fromY - 6 }
  }
  park()
  p.pos = { x, y: fromY }
  p.vel = { x: 0, y: 0 }
  p.facing = Math.PI / 2
  s.ball.ownerId = 4
  s.ball.mode = 'controlled'
  s.ball.pos = { x, y: fromY + 0.4 }
  s.ball.vel = { x: 0, y: 0 }
  s.possessionTeam = 0
  // Let the keeper settle while the shooter holds the ball.
  for (let i = 0; i < 60; i++) {
    park()
    sim.step([{ type: 'Move', dir: { x: 0, y: 0 }, sprint: false, sole: true }])
    s.ball.ownerId = 4
  }
  sim.drainEvents()
  sim.step([{ type: 'Shoot', dir: { x: aimX, y: 1 }, power }])
  for (let i = 0; i < 240; i++) {
    sim.step()
    for (const e of sim.drainEvents()) {
      if (e.type === 'GoalScored') return 'goal'
      if (e.type === 'Save') return 'saved'
      if (e.type === 'PossessionChanged' && e.team === 1) return 'saved'
      if (e.type === 'BallOut') return 'out'
    }
  }
  return 'other'
}

function tally(fromY: number, power: number, seeds = 20): Record<Outcome, number> {
  const t: Record<Outcome, number> = { goal: 0, saved: 0, out: 0, other: 0 }
  for (let seed = 1; seed <= seeds; seed++)
    t[shotOutcome(seed, fromY, (seed % 3) - 1, power, seed % 2 ? 1 : -1)]++
  return t
}

describe('goalkeeper', () => {
  it('long-range shots from the shooter’s own half are not goals (the keeper has time to react)', () => {
    for (const fromY of [-12, -5]) {
      const t = tally(fromY, 1)
      expect(t.goal).toBe(0)
      // Full-power shots from that far are saved or fly over/wide (full charge lifts the ball).
      expect(t.saved + t.out).toBeGreaterThan(15)
    }
  })

  it('shots from 18 m are handled by the keeper', () => {
    expect(tally(2, 1).goal).toBeLessThanOrEqual(1)
  })

  it('close-range powerful shots are sometimes scored and sometimes saved', () => {
    const t = tally(12, 0.55)
    expect(t.goal).toBeGreaterThanOrEqual(3)
    expect(t.saved).toBeGreaterThanOrEqual(3)
  })
})

describe('kick-off positions', () => {
  it('at every kick-off all players are in their own half and the defenders are outside the centre circle', () => {
    let kickoffs = 0
    for (const seed of [1, 3, 7]) {
      const sim = newSim(seed, null)
      const s = sim.state
      for (let i = 0; i < TICK_RATE * 240; i++) {
        const r = s.restart
        const kickingNow = r?.type === 'kickoff' && r.ready
        sim.step()
        // The kick happens in this step: check positions right at the restart.
        if (kickingNow && s.phase === 'play') {
          kickoffs++
          for (const p of s.players) {
            const dir = s.teams[p.team].attackDir
            if (p.id === r.takerId) continue
            expect(dir * p.pos.y).toBeLessThanOrEqual(0.05)
            if (p.team !== r.team) {
              expect(Math.hypot(p.pos.x, p.pos.y)).toBeGreaterThanOrEqual(COURT.centerCircleRadius - 0.05)
            }
          }
        }
      }
    }
    expect(kickoffs).toBeGreaterThan(1)
  })

  it('a human player left in the opponent half is walked back so the kick-off is not blocked', () => {
    const sim = newSim(4)
    const s = sim.state
    for (let i = 0; i < 600 && !s.restart?.ready; i++) sim.step()
    sim.step([{ type: 'Pass', dir: { x: 0, y: -1 }, through: false }])
    for (let i = 0; i < 60; i++) sim.step()
    // Force a goal for team 0 with the controlled player deep in the opponent half.
    const p = sim.player(s.controlledId!)
    p.pos = { x: 2, y: 15 }
    s.ball.ownerId = null
    s.ball.mode = 'free'
    s.ball.pos = { x: 0, y: 19.6 }
    s.ball.vel = { x: 0, y: 8 }
    s.ball.lastTouchTeam = 0
    s.ball.lastTouchId = 4
    sim.player(5).pos = { x: -8, y: 18 } // keeper out of the way
    s.phase = 'play'
    s.restart = null
    sim.drainEvents()
    let resumed = false
    for (let i = 0; i < TICK_RATE * 15 && !resumed; i++) {
      sim.step()
      resumed = sim.drainEvents().some((e) => e.type === 'PlayResumed')
    }
    expect(s.score[0]).toBe(1)
    expect(resumed).toBe(true)
  })

  it('players cannot cross into the opponent half while the kick-off is pending', () => {
    const sim = newSim(2)
    const s = sim.state
    // Before the first kick-off is taken: switch to another player and push forward.
    for (let i = 0; i < 30; i++) sim.step()
    const ala = sim.player(2)
    s.controlledId = ala.id
    for (let i = 0; i < 240; i++) sim.step([{ type: 'Move', dir: { x: 0, y: 1 }, sprint: true, sole: false }])
    expect(ala.pos.y).toBeLessThanOrEqual(0)
  })
})
