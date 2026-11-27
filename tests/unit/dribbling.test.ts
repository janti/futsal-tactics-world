import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { MatchSimulation } from '../../src/simulation/MatchSimulation'
import { passInterception } from '../../src/ai/BasicAI'
import { TICK_RATE } from '../../src/simulation/SimulationConfig'

/** Human team 0 in open play: player 2 has the ball at (0, -12); everyone else is parked far away. */
function openPlay(seed = 5) {
  const sim = new MatchSimulation({ seed, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: 0 })
  const s = sim.state
  s.phase = 'play'
  s.restart = null
  for (const o of s.players) {
    o.vel = { x: 0, y: 0 }
    if (o.role !== 'GK') o.pos = { x: o.id % 2 ? 9.5 : -9.5, y: 14 + (o.id % 3) }
  }
  const p = sim.player(2)
  p.pos = { x: 0, y: -12 }
  p.facing = Math.PI / 2
  s.controlledId = 2
  s.ball.ownerId = 2
  s.ball.mode = 'controlled'
  s.ball.pos = { x: 0, y: -11.6 }
  s.ball.vel = { x: 0, y: 0 }
  s.ball.z = 0
  s.ball.lastTouchTeam = 0
  s.ball.lastTouchId = 2
  s.possessionTeam = 0
  return { sim, s, p }
}

describe('touch-based dribbling', () => {
  it('sprinting knocks the ball ahead in touches and keeps it', () => {
    const { sim, s, p } = openPlay()
    let maxAhead = 0
    let minAhead = Infinity
    for (let i = 0; i < TICK_RATE * 2.5; i++) {
      sim.step([{ type: 'Move', dir: { x: 0, y: 1 }, sprint: true, sole: false }])
      if (i > 40) {
        const ahead = s.ball.pos.y - p.pos.y
        maxAhead = Math.max(maxAhead, ahead)
        minAhead = Math.min(minAhead, ahead)
      }
    }
    expect(s.ball.ownerId).toBe(2)
    // Close to the feet even at a sprint (well under a metre), but visibly touched ahead and caught up.
    // The human player's sprint touches are short (the ball stays close), but it is still knocked on.
    expect(maxAhead).toBeGreaterThan(0.45)
    expect(maxAhead).toBeLessThan(0.95)
    expect(maxAhead - minAhead).toBeGreaterThan(0.15) // touch, roll, catch up, touch...
  })

  it('normal running keeps the ball close to the feet', () => {
    const { sim, s, p } = openPlay()
    let maxAhead = 0
    for (let i = 0; i < TICK_RATE * 2; i++) {
      sim.step([{ type: 'Move', dir: { x: 0, y: 1 }, sprint: false, sole: false }])
      if (i > 30) maxAhead = Math.max(maxAhead, Math.hypot(s.ball.pos.x - p.pos.x, s.ball.pos.y - p.pos.y))
    }
    expect(s.ball.ownerId).toBe(2)
    expect(maxAhead).toBeLessThan(0.65)
  })
})

describe('shielding', () => {
  it('holding the sole button with no direction turns the back to the nearest opponent', () => {
    const { sim, s, p } = openPlay()
    const opp = sim.player(7)
    opp.pos = { x: 0, y: -10.5 } // in front of him
    for (let i = 0; i < 40; i++) {
      opp.vel = { x: 0, y: 0 }
      opp.pos = { x: 0, y: -10.5 }
      sim.step([{ type: 'Move', dir: { x: 0, y: 0 }, sprint: false, sole: true }])
    }
    expect(Math.sin(p.facing)).toBeLessThan(-0.8) // now facing away (down, sim -y)
    expect(s.ball.pos.y).toBeLessThan(p.pos.y) // ball on the far side from the opponent
  })
})

describe('first touch', () => {
  it('fast balls are sometimes controlled with a heavy touch that runs away from the receiver', () => {
    let heavy = 0
    let clean = 0
    for (let seed = 1; seed <= 60; seed++) {
      const { sim, s } = openPlay(seed)
      s.ball.ownerId = null
      s.ball.mode = 'free'
      const r = sim.player(3)
      r.pos = { x: 0, y: 0 }
      r.vel = { x: 0, y: 0 }
      r.touchCooldown = 0
      sim.player(2).pos = { x: -6, y: -14 }
      s.controlledId = 2
      s.ball.pos = { x: 0, y: -6 }
      s.ball.vel = { x: 0, y: 19 } // a very hard pass (firm ones up to 12 m/s are taken cleanly)
      s.ball.lastTouchTeam = 0
      s.ball.lastTouchId = 2
      s.ball.intendedReceiverId = 3
      for (let i = 0; i < 40; i++) {
        sim.step()
        if (s.ball.ownerId === 3) {
          clean++
          break
        }
        if (s.ball.lastTouchId === 3 && s.ball.ownerId === null) {
          heavy++
          break
        }
      }
    }
    expect(heavy).toBeGreaterThan(2)
    expect(clean).toBeGreaterThan(heavy)
  })
})

describe('AI pass interception', () => {
  it('a defender near the path of a pass reads it; one far away does not', () => {
    const { sim, s } = openPlay()
    s.ball.ownerId = null
    s.ball.mode = 'free'
    s.ball.pos = { x: -6, y: 0 }
    s.ball.vel = { x: 9, y: 0 }
    s.ball.lastTouchTeam = 0
    s.ball.lastTouchId = 2
    s.ball.intendedReceiverId = 3
    sim.player(3).pos = { x: 6, y: 0 }
    const near = sim.player(7)
    near.pos = { x: -1, y: 0.8 } // close to the path: he gets there with time to spare
    const far = sim.player(8)
    far.pos = { x: 0, y: 9 }
    const cut = passInterception(s, near)
    expect(cut).not.toBeNull()
    expect(Math.abs(cut!.y)).toBeLessThan(0.2)
    expect(cut!.x).toBeLessThan(5.5)
    expect(passInterception(s, far)).toBeNull()
  })
})
