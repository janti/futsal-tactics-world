import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { MatchSimulation, createInitialState } from '../../src/simulation/MatchSimulation'
import { updatePlayerMovement } from '../../src/physics/PlayerPhysics'
import { DT, TICK_RATE } from '../../src/simulation/SimulationConfig'

function outfield() {
  const s = createInitialState({ seed: 3, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: 0 })
  const p = s.players[2]!
  p.pos = { x: 0, y: 0 }
  p.vel = { x: 0, y: 0 }
  p.facing = 0
  return p
}

describe('responsive movement', () => {
  it('the human-controlled player turns round faster than an AI player', () => {
    const turnTime = (human: boolean) => {
      const p = outfield()
      p.moveIntent = { x: -1, y: 0 } // reverse
      let t = 0
      while (Math.abs(Math.cos(p.facing) + 1) > 0.02 && t < 2) {
        updatePlayerMovement(p, false, DT, human)
        t += DT
      }
      return t
    }
    expect(turnTime(true)).toBeLessThan(turnTime(false) * 0.7)
    expect(turnTime(true)).toBeLessThan(0.25)
  })

  it('an AI player running hard away from what he watches turns and runs (no long backwards sprint)', () => {
    const p = outfield()
    p.faceTarget = { x: 10, y: 0 } // watching something behind his run
    p.moveIntent = { x: -1, y: 0 }
    for (let i = 0; i < TICK_RATE * 0.5; i++) updatePlayerMovement(p, false, DT)
    expect(Math.cos(p.facing)).toBeLessThan(-0.9) // facing the run
    // Jogging slowly he may keep watching it (a short shuffle).
    const q = outfield()
    q.faceTarget = { x: 10, y: 0 }
    q.moveIntent = { x: -0.4, y: 0 }
    for (let i = 0; i < TICK_RATE * 0.5; i++) updatePlayerMovement(q, false, DT)
    expect(Math.cos(q.facing)).toBeGreaterThan(0.9)
  })
})

describe('goalkeeper save style', () => {
  /** Opponent shot from 7 m towards `crossX` on team 0's goal line; returns the keeper's save style. */
  function save(seed: number, crossX: number, gkX = 0) {
    const sim = new MatchSimulation({ seed, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: 0 })
    const s = sim.state
    for (let i = 0; i < 600 && !s.restart?.ready; i++) sim.step()
    sim.step([{ type: 'Pass', dir: { x: 0, y: 1 }, through: false }])
    for (let i = 0; i < 30; i++) sim.step()
    s.phase = 'play'
    s.restart = null
    const gk = sim.player(0)
    gk.pos = { x: gkX, y: -19.3 }
    gk.vel = { x: 0, y: 0 }
    gk.touchCooldown = 0
    gk.shotStartX = gkX // where he stood when the (injected) shot was struck
    for (const p of s.players) if (p.role !== 'GK') p.pos = { x: p.id % 2 ? 9 : -9, y: 5 }
    const b = s.ball
    Object.assign(b, { ownerId: null, mode: 'free', inHands: false, z: 0.2, vz: 0.4, isShot: true })
    b.pos = { x: gkX * 2, y: -12 }
    const v = { x: crossX - b.pos.x, y: -8 }
    const l = Math.hypot(v.x, v.y)
    b.vel = { x: (v.x / l) * 15, y: (v.y / l) * 15 }
    b.lastTouchTeam = 1
    b.lastTouchId = 8
    b.lastKickerId = 8
    b.kickPos = { ...b.pos }
    sim.drainEvents()
    for (let i = 0; i < 60; i++) {
      sim.step()
      if (gk.action === 'save') return gk.saveDive
    }
    return null
  }

  it('from the middle he never dives: shots near him or into a corner are saved standing up', () => {
    const results = [1, 2, 3].flatMap((seed) => [save(seed, 0.4), save(seed, 1.3), save(seed, -1.3)])
    const attempts = results.filter((x) => x !== null)
    expect(attempts.length).toBeGreaterThan(2)
    expect(attempts.every((x) => x === false)).toBe(true)
  })

  it('caught at the near post, he dives for an accurate shot to the far post', () => {
    const dives = [1, 2, 3, 4].map((seed) => save(seed, -1.35, 1.1)).filter((x) => x !== null)
    expect(dives.length).toBeGreaterThan(0)
    expect(dives.some((x) => x === true)).toBe(true)
  })
})

describe('after a goal', () => {
  it('both teams are back in their own half quickly and the kick-off is ready within about 5 s', () => {
    let measured = 0
    for (const seed of [1, 2, 4]) {
      const sim = new MatchSimulation({ seed, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: 0 })
      const s = sim.state
      let goalTick = -1
      for (let i = 0; i < TICK_RATE * 400 && goalTick < 0; i++) {
        const r = s.restart
        const kick = r?.ready && r.team === 0 && s.controlledId === r.takerId
        sim.step(kick ? [{ type: 'Pass', dir: { x: 0, y: 1 }, through: false }] : [])
        for (const e of sim.drainEvents()) if (e.type === 'GoalScored') goalTick = s.tick
      }
      if (goalTick < 0) continue
      while (!s.restart?.ready && s.tick - goalTick < TICK_RATE * 10) sim.step()
      // Celebration 3 s + kick-off delay 1.4 s is the minimum; players hurrying back add a little
      // (the alas line up deeper at the kick-off since they offer an easier ball there).
      expect((s.tick - goalTick) / TICK_RATE).toBeLessThan(6)
      measured++
    }
    expect(measured).toBeGreaterThan(0)
  }, 30000)
})
