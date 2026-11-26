import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { MatchSimulation, createInitialState } from '../../src/simulation/MatchSimulation'
import { estimateTimeToReach } from '../../src/physics/PlayerPhysics'
import {
  attackingRole,
  carrierOptions,
  controlAt,
  shotValue,
  TRANSITION_ATTACK_TIME,
} from '../../src/ai/BasicAI'
import { SeededRandom } from '../../src/core/random/SeededRandom'
import { TICK_RATE } from '../../src/simulation/SimulationConfig'

function state() {
  const s = createInitialState({ seed: 5, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: null })
  s.phase = 'play'
  return s
}

describe('time-to-reach model', () => {
  it('a player facing away needs longer than one facing the target', () => {
    const s = state()
    const p = s.players[2]!
    p.pos = { x: 0, y: 0 }
    p.vel = { x: 0, y: 0 }
    p.facing = Math.PI / 2 // facing +y
    const ahead = estimateTimeToReach(p, { x: 0, y: 5 })
    const behind = estimateTimeToReach(p, { x: 0, y: -5 })
    expect(behind).toBeGreaterThan(ahead + 0.05)
  })
})

describe('team phases', () => {
  it('winning the ball opens a counter-attack window, then the team settles into attack', () => {
    const sim = new MatchSimulation({
      seed: 2,
      home: TEAM_LIBRARY[0]!,
      away: TEAM_LIBRARY[1]!,
      humanTeam: null,
    })
    const s = sim.state
    for (let i = 0; i < 600 && !s.restart?.ready; i++) sim.step()
    expect(s.teamPhase[0]).toBe('setPiece')
    for (let i = 0; i < 240 && s.phase !== 'play'; i++) sim.step()
    s.ball.ownerId = 3
    s.ball.mode = 'controlled'
    s.possessionTeam = 0
    s.possessionSinceTick = s.tick
    sim.step()
    expect(s.teamPhase[0]).toBe('transitionAttack')
    expect(['defence', 'transitionDefence']).toContain(s.teamPhase[1])
    s.possessionSinceTick = s.tick - TICK_RATE * (TRANSITION_ATTACK_TIME + 0.5)
    s.ball.ownerId = 3
    sim.step()
    if (s.possessionTeam === 0) expect(s.teamPhase[0]).toBe('attack')
  })
})

describe('pitch control', () => {
  it('space near our players is ours, space near the opponents is not', () => {
    const s = state()
    for (const p of s.players) p.pos = p.team === 0 ? { x: -6, y: -10 + p.id } : { x: 6, y: 10 - (p.id - 5) }
    expect(controlAt(s, 0, { x: -6, y: -8 })).toBeGreaterThan(0.8)
    expect(controlAt(s, 0, { x: 6, y: 8 })).toBeLessThan(0.2)
    const mid = controlAt(s, 0, { x: 0, y: 0 })
    expect(controlAt(s, 1, { x: 0, y: 0 })).toBeCloseTo(1 - mid, 5)
  })
})

describe('dynamic roles in attack', () => {
  it('players who swapped places swap roles instead of running back', () => {
    const s = state()
    s.possessionTeam = 0
    s.ball.ownerId = 1
    s.ball.pos = { x: 0, y: -6 }
    const dir = s.teams[0].attackDir
    // Left ala (2) has made a run up front and the pivot (4) has dropped to the left wing.
    s.players[1]!.pos = { x: 0, y: -6 * dir }
    s.players[2]!.pos = { x: 0, y: 6 * dir }
    s.players[3]!.pos = { x: -6 * dir, y: -1 * dir }
    s.players[4]!.pos = { x: 6 * dir, y: -1 * dir }
    expect(attackingRole(s, s.players[2]!)).toBe('PIVOT')
    expect(attackingRole(s, s.players[4]!)).toBe('ALA_L')
    // Out of possession everyone keeps his nominal role.
    s.possessionTeam = 1
    expect(attackingRole(s, s.players[2]!)).toBe('ALA_L')
  })
})

describe('utility decisions for the carrier', () => {
  it('shot value falls with distance and angle', () => {
    const s = state()
    const dir = s.teams[0].attackDir
    const near = shotValue(s, 0, { x: 0, y: dir * 14 }, 2, 0)
    const far = shotValue(s, 0, { x: 0, y: dir * 6 }, 2, 0)
    const wide = shotValue(s, 0, { x: 9.5, y: dir * 19 }, 2, 0)
    expect(near).toBeGreaterThan(far)
    expect(near).toBeGreaterThan(wide)
  })

  it('a teammate free in front of goal beats a poor shot of our own (the square ball)', () => {
    const s = state()
    const dir = s.teams[0].attackDir
    for (const p of s.players) p.pos = { x: p.team === 0 ? -9 : 9, y: p.team === 0 ? -18 * dir : 18 * dir }
    const carrier = s.players[3]!
    carrier.pos = { x: 6.5, y: dir * 11 } // wide, poor angle for a shot
    carrier.aiHoldTimer = 1
    s.players[4]!.pos = { x: 0.5, y: dir * 15 } // free, central, 5 m out
    s.players[5]!.pos = { x: 0, y: dir * 19.3 } // their keeper
    s.ball.ownerId = 3
    s.ball.pos = { ...carrier.pos }
    s.possessionTeam = 0
    const options = carrierOptions(s, carrier, new SeededRandom(1), {
      open: true,
      pressure: 0,
      toGoal: Math.hypot(carrier.pos.x, carrier.pos.y - dir * 20),
      goal: { x: 0, y: dir * 20 },
      nearest: null,
    })
    const best = options.reduce((a, b) => (b.utility > a.utility ? b : a))
    expect(best.kind).toBe('direct')
  })
})
