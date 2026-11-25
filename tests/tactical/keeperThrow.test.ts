import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { MatchSimulation } from '../../src/simulation/MatchSimulation'
import { HANDS, THROW, TICK_RATE } from '../../src/simulation/SimulationConfig'

/** Human team 0 (defends y = -20). An opponent's ball rolls to our keeper (id 0), who gathers it. */
function keeperWithBall(seed = 31) {
  const sim = new MatchSimulation({ seed, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: 0 })
  const s = sim.state
  for (let i = 0; i < 600 && !s.restart?.ready; i++) sim.step()
  sim.step([{ type: 'Pass', dir: { x: 0, y: -1 }, through: false }])
  for (let i = 0; i < 30; i++) sim.step()
  s.phase = 'play'
  s.restart = null
  const gk = sim.player(0)
  gk.pos = { x: 0, y: -18.5 }
  gk.vel = { x: 0, y: 0 }
  gk.touchCooldown = 0
  for (const o of s.players) if (o.team === 1 && o.role !== 'GK') o.pos = { x: o.id % 2 ? 8 : -8, y: 5 }
  s.ball.ownerId = null
  s.ball.mode = 'free'
  s.ball.inHands = false
  s.ball.pos = { x: 0, y: -15.5 }
  s.ball.z = 0
  s.ball.vel = { x: 0, y: -5 }
  s.ball.lastTouchTeam = 1
  s.ball.lastTouchId = 9
  s.ball.lastKickerId = 9
  s.ball.intendedReceiverId = null
  for (let i = 0; i < 90 && s.ball.ownerId !== 0; i++) sim.step()
  expect(s.ball.ownerId).toBe(0)
  expect(s.ball.inHands).toBe(true)
  sim.drainEvents()
  return { sim, s, gk }
}

describe('controllable goalkeeper throw', () => {
  it('the human team controls its own keeper when he holds the ball', () => {
    const { s } = keeperWithBall()
    expect(s.controlledId).toBe(0)
  })

  it('the throw goes in the chosen direction', () => {
    for (const dir of [
      { x: 1, y: 0.3 },
      { x: -1, y: 1 },
      { x: 0, y: 1 },
    ]) {
      const { sim, s } = keeperWithBall()
      sim.step([{ type: 'Throw', dir, power: 0.5 }])
      expect(s.ball.ownerId).toBeNull()
      expect(s.ball.inHands).toBe(false)
      const want = Math.atan2(dir.y, dir.x)
      const got = Math.atan2(s.ball.vel.y, s.ball.vel.x)
      expect(Math.abs(Math.atan2(Math.sin(got - want), Math.cos(got - want)))).toBeLessThan(0.15)
    }
  })

  it('power controls the throw: soft = bowled along the floor, hard = faster overarm throw in the air', () => {
    const soft = keeperWithBall()
    soft.sim.step([{ type: 'Throw', dir: { x: 0, y: 1 }, power: 0.2 }])
    const hard = keeperWithBall()
    hard.sim.step([{ type: 'Throw', dir: { x: 0, y: 1 }, power: 1 }])
    const vSoft = Math.hypot(soft.s.ball.vel.x, soft.s.ball.vel.y)
    const vHard = Math.hypot(hard.s.ball.vel.x, hard.s.ball.vel.y)
    expect(vHard).toBeGreaterThan(vSoft + 6)
    expect(vSoft).toBeGreaterThanOrEqual(THROW.minSpeed * 0.9)
    expect(soft.s.ball.z).toBe(0)
    expect(soft.s.ball.vz).toBe(0)
    expect(hard.s.ball.vz).toBeGreaterThan(0)
    expect(hard.s.ball.z).toBeGreaterThan(0.5)
  })

  it('aiming turns the keeper without moving him', () => {
    const { sim, gk } = keeperWithBall()
    const p0 = { ...gk.pos }
    for (let i = 0; i < 30; i++)
      sim.step([{ type: 'Move', dir: { x: 1, y: 0 }, sprint: false, sole: false, aimOnly: true }])
    expect(Math.hypot(gk.pos.x - p0.x, gk.pos.y - p0.y)).toBeLessThan(0.05)
    expect(Math.cos(gk.facing)).toBeGreaterThan(0.95) // facing sim +x
  })

  it('control passes to the teammate on the line of the throw', () => {
    const { sim, s } = keeperWithBall()
    const target = sim.player(2)
    target.pos = { x: -6, y: -8 }
    const dir = { x: target.pos.x - 0, y: target.pos.y - -18.5 }
    sim.step([{ type: 'Throw', dir, power: 0.5 }])
    expect(s.ball.intendedReceiverId).toBe(2)
    expect(s.controlledId).toBe(2)
    expect(sim.drainEvents().some((e) => e.type === 'KeeperThrow')).toBe(true)
  })

  it('the keeper cannot carry the ball out of the penalty area', () => {
    const { sim, gk } = keeperWithBall()
    for (let i = 0; i < TICK_RATE * 2; i++)
      sim.step([{ type: 'Move', dir: { x: 0, y: 1 }, sprint: true, sole: false }])
    expect(sim.inOwnPenaltyArea(gk, gk.pos)).toBe(true)
    expect(sim.state.ball.inHands).toBe(true)
  })

  it('holding too long hands the throw to the AI', () => {
    const { sim, s } = keeperWithBall()
    let timeout = false
    let thrown = false
    for (let i = 0; i < TICK_RATE * (HANDS.holdLimit + 2) && !thrown; i++) {
      sim.step()
      for (const e of sim.drainEvents()) {
        if (e.type === 'KeeperHoldTimeout') timeout = true
        if (e.type === 'PassStarted' && e.playerId === 0) thrown = true
      }
    }
    expect(timeout).toBe(true)
    expect(thrown).toBe(true)
    expect(s.ball.inHands).toBe(false)
  })
})

describe('goal clearance', () => {
  it('the keeper gathers the ball facing the court, ball in his hands in front of him', () => {
    for (const humanTeam of [0, null] as const) {
      const sim = new MatchSimulation({ seed: 14, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam })
      const s = sim.state
      for (let i = 0; i < 600 && s.phase !== 'play'; i++) {
        const r = s.restart
        sim.step(
          r?.ready && r.team === humanTeam ? [{ type: 'Pass', dir: { x: 0, y: -1 }, through: false }] : [],
        )
      }
      // The ball goes over team 0's goal line off an opponent: goal clearance for team 0.
      const dir = s.teams[0].attackDir
      const gk = sim.player(0)
      gk.pos = { x: 2, y: -dir * 14 } // out of his goal: he has to walk back towards it
      s.ball.ownerId = null
      s.ball.mode = 'free'
      s.ball.pos = { x: 4, y: -dir * 19.6 }
      s.ball.z = 0
      s.ball.vel = { x: 0, y: -dir * 6 }
      s.ball.lastTouchTeam = 1
      s.ball.lastTouchId = 9
      s.ball.lastKickerId = 9
      let gathered = false
      for (let i = 0; i < TICK_RATE * 10 && !gathered; i++) {
        sim.step()
        gathered = s.phase === 'play' && s.ball.ownerId === 0 && s.ball.inHands
      }
      expect(gathered).toBe(true)
      // Facing the court (towards the opponent half), ball in front of him.
      expect(Math.sin(gk.facing) * dir).toBeGreaterThan(0.9)
      expect((s.ball.pos.y - gk.pos.y) * dir).toBeGreaterThan(0.15)
    }
  })
})
