import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { shotHeightForPower } from '../../src/physics/ShootingPhysics'
import { MatchSimulation } from '../../src/simulation/MatchSimulation'
import { COURT, SHOT } from '../../src/simulation/SimulationConfig'
import type { Vec2 } from '../../src/core/math/vec2'

describe('shot height from the charge (heavy futsal ball)', () => {
  it('a tap is low, height grows slowly at first and a full charge goes over the bar', () => {
    expect(shotHeightForPower(0.3)).toBeLessThan(0.15)
    expect(shotHeightForPower(0.5)).toBeLessThan(0.6)
    expect(shotHeightForPower(0.75)).toBeGreaterThan(shotHeightForPower(0.5))
    expect(shotHeightForPower(1)).toBeGreaterThan(COURT.goalHeight)
    let prev = -1
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const h = shotHeightForPower(p)
      expect(h).toBeGreaterThanOrEqual(prev)
      prev = h
    }
  })
})

type Result = { outcome: 'goal' | 'saved' | 'over' | 'wide' | 'other'; caught: boolean; peak: number }

/** Human attacker (team 0, attacking +y) shoots; keeper id 5 at goal y = +20; everyone else parked. */
function shoot(seed: number, from: Vec2, power: number, aimX = 1): Result {
  const sim = new MatchSimulation({ seed, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: 0 })
  const s = sim.state
  for (let i = 0; i < 600 && !s.restart?.ready; i++) sim.step()
  sim.step([{ type: 'Pass', dir: { x: 0, y: -1 }, through: false }])
  for (let i = 0; i < 60; i++) sim.step()
  s.phase = 'play'
  s.restart = null
  const park = () => {
    for (const o of s.players) if (o.id !== 4 && o.role !== 'GK') o.pos = { x: o.id % 2 ? 9.5 : -9.5, y: -6 }
  }
  const p = sim.player(4)
  s.controlledId = 4
  p.pos = { ...from }
  p.vel = { x: 0, y: 0 }
  p.facing = Math.PI / 2
  s.ball.ownerId = 4
  s.ball.mode = 'controlled'
  s.ball.pos = { x: from.x, y: from.y + 0.4 }
  s.possessionTeam = 0
  for (let i = 0; i < 60; i++) {
    park()
    sim.step([{ type: 'Move', dir: { x: 0, y: 0 }, sprint: false, sole: true }])
    s.ball.ownerId = 4
  }
  sim.drainEvents()
  sim.step([{ type: 'Shoot', dir: { x: aimX, y: 1 }, power }])
  let peak = 0
  let caught = false
  for (let i = 0; i < 240; i++) {
    sim.step()
    peak = Math.max(peak, s.ball.z)
    if (s.ball.ownerId === 5 && s.ball.inHands) caught = true
    for (const e of sim.drainEvents()) {
      if (e.type === 'GoalScored') return { outcome: 'goal', caught, peak }
      if (e.type === 'Save') return { outcome: 'saved', caught: e.caught || caught, peak }
      if (e.type === 'PossessionChanged' && e.team === 1)
        return { outcome: 'saved', caught: s.ball.inHands, peak }
      if (e.type === 'BallOut')
        return { outcome: Math.abs(s.ball.pos.x) < COURT.goalHalfWidth + 0.3 ? 'over' : 'wide', caught, peak }
    }
  }
  return { outcome: 'other', caught, peak }
}

describe('shots in play', () => {
  it('holding the button to full charge usually sends the ball over the bar', () => {
    let over = 0
    for (let seed = 1; seed <= 20; seed++) if (shoot(seed, { x: 0, y: 9 }, 1).outcome === 'over') over++
    expect(over).toBeGreaterThanOrEqual(12)
  })

  it('a quick tap is a low placed shot the keeper can never hold (scored or at best parried)', () => {
    let goals = 0
    for (let seed = 1; seed <= 20; seed++) {
      const r = shoot(seed, { x: 1.5, y: 12.5 }, SHOT.placedMaxPower, seed % 2 ? 1 : -1)
      expect(r.caught).toBe(false)
      expect(r.peak).toBeLessThan(0.6)
      if (r.outcome === 'goal') goals++
    }
    expect(goals).toBeGreaterThanOrEqual(6)
  })
})

describe('keeper throw arc', () => {
  it('a longer press throws higher, and a hard throw arcs higher than a firm shot', () => {
    const peakFor = (power: number) => {
      const sim = new MatchSimulation({
        seed: 9,
        home: TEAM_LIBRARY[0]!,
        away: TEAM_LIBRARY[1]!,
        humanTeam: null,
      })
      const s = sim.state
      for (let i = 0; i < 600 && s.phase !== 'play'; i++) sim.step()
      const gk = sim.player(0)
      gk.pos = { x: 0, y: -18 }
      s.ball.ownerId = 0
      s.ball.mode = 'controlled'
      s.ball.inHands = true
      sim.throwBall(gk, { x: 0, y: 1 }, power)
      let peak = 0
      for (let i = 0; i < 180; i++) {
        sim.step()
        peak = Math.max(peak, s.ball.z)
      }
      return { peak, z0: s.ball.z }
    }
    const soft = peakFor(0.2).peak
    const mid = peakFor(0.6).peak
    const hard = peakFor(1).peak
    expect(soft).toBeLessThan(0.3) // bowled along the floor
    expect(mid).toBeGreaterThan(soft)
    expect(hard).toBeGreaterThan(mid)
    expect(hard).toBeGreaterThan(2.5)
    const shotPeak = shoot(3, { x: 0, y: 9 }, 0.7).peak
    expect(hard).toBeGreaterThan(shotPeak)
  })
})
