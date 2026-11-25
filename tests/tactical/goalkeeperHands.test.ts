import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { MatchSimulation } from '../../src/simulation/MatchSimulation'
import { HANDS, TICK_RATE } from '../../src/simulation/SimulationConfig'

/** AI vs AI match in open play; team 1's keeper (id 5) defends the goal at y = +20. */
function openPlay(seed = 21) {
  const sim = new MatchSimulation({ seed, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: null })
  for (let i = 0; i < 900 && sim.state.phase !== 'play'; i++) sim.step()
  sim.state.phase = 'play'
  sim.state.restart = null
  return sim
}

/** Roll the ball gently to the keeper (id 5), last touched by `fromId`. */
function rollToKeeper(sim: MatchSimulation, fromId: number) {
  const s = sim.state
  const gk = sim.player(5)
  gk.pos = { x: 0, y: 18.5 }
  gk.vel = { x: 0, y: 0 }
  const from = sim.player(fromId)
  s.ball.ownerId = null
  s.ball.mode = 'free'
  s.ball.inHands = false
  s.ball.pos = { x: 0, y: 15.5 }
  s.ball.z = 0
  s.ball.vel = { x: 0, y: 5 }
  s.ball.lastTouchId = from.id
  s.ball.lastTouchTeam = from.team
  s.ball.intendedReceiverId = from.team === 1 ? 5 : null
  for (let i = 0; i < 90 && s.ball.ownerId !== 5; i++) sim.step()
  expect(s.ball.ownerId).toBe(5)
}

describe('goalkeeper hands and feet', () => {
  it('an opponent shot/ball gathered in the own penalty area is held in the hands', () => {
    const sim = openPlay()
    rollToKeeper(sim, 4) // last touched by an opponent (team 0 pivot)
    expect(sim.state.ball.inHands).toBe(true)
    expect(sim.state.ball.z).toBeCloseTo(HANDS.height)
  })

  it('opponents cannot win a ball held in the hands', () => {
    const sim = openPlay()
    rollToKeeper(sim, 4)
    const s = sim.state
    const gk = sim.player(5)
    const attacker = sim.player(4)
    for (let i = 0; i < TICK_RATE * 0.8; i++) {
      // The attacker stands right on the ball and tries to tackle.
      attacker.pos = { x: s.ball.pos.x, y: s.ball.pos.y - 0.3 }
      attacker.touchCooldown = 0
      attacker.tackleCooldown = 0
      sim.tackle(attacker)
      sim.step()
      if (s.ball.ownerId !== gk.id) break
    }
    // Still the keeper's (or already distributed by the keeper), never the attacker's.
    expect(s.ball.ownerId === gk.id || s.ball.lastTouchId === gk.id).toBe(true)
    expect(s.ball.lastTouchTeam).toBe(1)
  })

  it('a back pass from a teammate is played with the feet and can be challenged like an outfield player', () => {
    const sim = openPlay()
    rollToKeeper(sim, 6) // own fixo passes back
    const s = sim.state
    expect(s.ball.inHands).toBe(false)
    expect(s.ball.z).toBe(0)
    // A pressing opponent on the ball can win it.
    const gk = sim.player(5)
    const attacker = sim.player(4)
    attacker.profile.attributes.tackling = 99
    let won = false
    for (let i = 0; i < TICK_RATE * 2 && !won; i++) {
      if (s.ball.ownerId !== gk.id) break
      attacker.pos = { x: s.ball.pos.x, y: s.ball.pos.y - 0.25 }
      attacker.touchCooldown = 0
      sim.step()
      won = s.ball.lastTouchTeam === 0
    }
    expect(won).toBe(true)
  })

  it('outside the penalty area the keeper never uses the hands', () => {
    const sim = openPlay()
    const s = sim.state
    const gk = sim.player(5)
    gk.pos = { x: 0, y: 11 }
    gk.touchCooldown = 0
    for (const o of s.players) if (o.id !== 5 && o.role !== 'GK') o.pos = { x: o.id % 2 ? 9 : -9, y: 0 }
    s.ball.ownerId = null
    s.ball.mode = 'free'
    s.ball.pos = { x: 0, y: 10.5 }
    s.ball.vel = { x: 0, y: 1 }
    s.ball.lastTouchTeam = 0
    s.ball.lastTouchId = 4
    for (let i = 0; i < 90 && s.ball.ownerId !== 5; i++) {
      gk.pos = { x: 0, y: 11 }
      sim.step()
    }
    expect(s.ball.ownerId).toBe(5)
    expect(s.ball.inHands).toBe(false)
  })

  it('distribution from the hands releases the ball to a teammate', () => {
    const sim = openPlay()
    rollToKeeper(sim, 4)
    const s = sim.state
    let passed = false
    for (let i = 0; i < TICK_RATE * 3 && !passed; i++) {
      sim.step()
      passed = sim.drainEvents().some((e) => e.type === 'PassStarted' && e.playerId === 5)
    }
    expect(passed).toBe(true)
    expect(s.ball.inHands).toBe(false)
  })
})
