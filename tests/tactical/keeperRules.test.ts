import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { chooseReceiver } from '../../src/physics/PassingPhysics'
import type { MatchEvent } from '../../src/simulation/Events'
import { MatchSimulation } from '../../src/simulation/MatchSimulation'
import { HANDS, TICK_RATE } from '../../src/simulation/SimulationConfig'

/** Open play with team 0 defending y = -20 (keeper id 0). Opponent outfielders parked away. */
function openPlay(seed: number, humanTeam: 0 | null) {
  const sim = new MatchSimulation({ seed, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam })
  const s = sim.state
  for (let i = 0; i < 900 && s.phase !== 'play'; i++) {
    const r = s.restart
    sim.step(r?.ready && r.team === humanTeam ? [{ type: 'Pass', dir: { x: 0, y: -1 }, through: false }] : [])
  }
  for (let i = 0; i < 30; i++) sim.step()
  s.phase = 'play'
  s.restart = null
  for (const o of s.players) if (o.role !== 'GK') o.pos = { x: o.id % 2 ? 8 : -8, y: 4 + (o.id % 3) }
  sim.drainEvents()
  return { sim, s, gk: sim.player(0) }
}

function shootAtKeeper(
  sim: MatchSimulation,
  from: { x: number; y: number },
  target: { x: number; y: number },
  speed: number,
  z = 0.4,
) {
  const s = sim.state
  const d = Math.hypot(target.x - from.x, target.y - from.y)
  s.ball.ownerId = null
  s.ball.mode = 'free'
  s.ball.inHands = false
  s.ball.pos = { ...from }
  s.ball.z = z
  s.ball.vz = 0.8
  s.ball.vel = { x: ((target.x - from.x) / d) * speed, y: ((target.y - from.y) / d) * speed }
  s.ball.lastTouchTeam = 1
  s.ball.lastTouchId = 9
  s.ball.lastKickerId = 9
  s.ball.kickPos = { ...from }
  s.ball.kickTime = s.time
  s.ball.isShot = true
  s.ball.shotLongRange = false
  s.ball.shotPlaced = false
  s.ball.shotScreen = 0
  s.ball.intendedReceiverId = null
  s.ball.keeperRetouchId = null
}

describe('goalkeeper saves: catch or steer the ball away', () => {
  it('a parried shot is steered wide and away from the goal, never back towards it', () => {
    let parries = 0
    let catches = 0
    for (let seed = 1; seed <= 30; seed++) {
      const { sim, s, gk } = openPlay(seed, null)
      gk.pos = { x: 0, y: -19 }
      gk.vel = { x: 0, y: 0 }
      gk.touchCooldown = 0
      // Hard shots at different heights/sides around the keeper.
      shootAtKeeper(
        sim,
        { x: (seed % 5) - 2, y: -12 },
        { x: ((seed % 3) - 1) * 0.9, y: -20 },
        12 + (seed % 6) * 3,
        0.2 + (seed % 3) * 0.4,
      )
      for (let i = 0; i < 60; i++) {
        sim.step()
        const evs = sim.drainEvents()
        const save = evs.find((e): e is Extract<MatchEvent, { type: 'Save' }> => e.type === 'Save')
        if (!save) continue
        if (save.caught) {
          catches++
          expect(s.ball.ownerId).toBe(0)
          expect(s.ball.inHands).toBe(true)
        } else {
          parries++
          // Team 0 defends y = -20: away from goal is +y. The ball goes mostly sideways (wide).
          expect(s.ball.vel.y).toBeGreaterThan(0)
          expect(Math.abs(s.ball.vel.x)).toBeGreaterThan(Math.abs(s.ball.vel.y))
        }
        break
      }
    }
    expect(parries).toBeGreaterThan(0)
    expect(catches).toBeGreaterThan(0)
  })

  it('after a catch the AI keeper distributes with a throw (same as a goal clearance)', () => {
    const { sim, s, gk } = openPlay(3, null)
    gk.pos = { x: 0, y: -18.5 }
    gk.touchCooldown = 0
    shootAtKeeper(sim, { x: 0, y: -14 }, { x: 0, y: -20 }, 8, 0)
    let caught = false
    let thrown = false
    for (let i = 0; i < TICK_RATE * 3 && !thrown; i++) {
      sim.step()
      for (const e of sim.drainEvents()) {
        if (e.type === 'KeeperThrow' && e.playerId === 0) thrown = true
      }
      if (s.ball.ownerId === 0 && s.ball.inHands) caught = true
      if (thrown) expect(gk.action).toBe('throw')
    }
    expect(caught).toBe(true)
    expect(thrown).toBe(true)
  })
})

describe('saves and rebounds go into the hands', () => {
  function looseBallToKeeper(lastTouchId: number, lastTouchTeam: 0 | 1, lastKickerId: number | null) {
    const { sim, s, gk } = openPlay(10, null)
    gk.pos = { x: 0, y: -18.3 }
    gk.vel = { x: 0, y: 0 }
    gk.touchCooldown = 0
    s.ball.ownerId = null
    s.ball.mode = 'free'
    s.ball.inHands = false
    s.ball.pos = { x: 0, y: -16 }
    s.ball.z = 0
    s.ball.vel = { x: 0, y: -2.5 }
    s.ball.lastTouchId = lastTouchId
    s.ball.lastTouchTeam = lastTouchTeam
    s.ball.lastKickerId = lastKickerId
    s.ball.intendedReceiverId = null
    s.ball.keeperRetouchId = null
    s.ball.isShot = false
    for (let i = 0; i < 90 && s.ball.ownerId !== 0; i++) sim.step()
    expect(s.ball.ownerId).toBe(0)
    return s
  }

  it('the rebound of his own parry is gathered into the hands', () => {
    expect(looseBallToKeeper(0, 0, null).ball.inHands).toBe(true)
  })

  it('a ball that deflected off a teammate (not a deliberate pass) may be handled', () => {
    expect(looseBallToKeeper(1, 0, null).ball.inHands).toBe(true)
  })

  it('a deliberate pass from a teammate may not be handled', () => {
    expect(looseBallToKeeper(1, 0, 1).ball.inHands).toBe(false)
  })
})

describe('back pass: the keeper plays like an outfield player (with the keeper rules)', () => {
  function backPass(seed: number, humanTeam: 0 | null) {
    const ctx = openPlay(seed, humanTeam)
    const { sim, s, gk } = ctx
    gk.pos = { x: 0, y: -17 }
    gk.vel = { x: 0, y: 0 }
    gk.touchCooldown = 0
    const fixo = sim.player(1)
    fixo.pos = { x: 0, y: -11 }
    s.ball.ownerId = null
    s.ball.mode = 'free'
    s.ball.inHands = false
    s.ball.pos = { x: 0, y: -14 }
    s.ball.z = 0
    s.ball.vel = { x: 0, y: -5 }
    s.ball.lastTouchTeam = 0
    s.ball.lastTouchId = 1
    s.ball.lastKickerId = 1 // deliberate pass by a teammate
    s.ball.intendedReceiverId = 0
    s.ball.keeperRetouchId = null
    for (let i = 0; i < 90 && s.ball.ownerId !== 0; i++) sim.step()
    expect(s.ball.ownerId).toBe(0)
    return ctx
  }

  it('no hands from a teammate’s pass: the ball is at the keeper’s feet and he kicks it', () => {
    const { sim, s, gk } = backPass(4, null)
    expect(s.ball.inHands).toBe(false)
    expect(s.ball.z).toBe(0)
    let kicked = false
    for (let i = 0; i < TICK_RATE * 2 && !kicked; i++) {
      sim.step()
      const ev = sim.drainEvents()
      expect(ev.some((e) => e.type === 'KeeperThrow')).toBe(false)
      kicked = ev.some((e) => e.type === 'PassStarted' && e.playerId === 0)
    }
    expect(kicked).toBe(true)
    expect(gk.action).toBe('pass')
  })

  it('the keeper comes to meet a teammate’s pass instead of waiting on his line', () => {
    const { sim, s, gk } = openPlay(8, null)
    gk.pos = { x: 0, y: -18.5 }
    gk.vel = { x: 0, y: 0 }
    gk.touchCooldown = 0
    const fixo = sim.player(1)
    fixo.pos = { x: 1, y: -5 }
    fixo.vel = { x: 0, y: 0 }
    s.ball.ownerId = 1
    s.ball.mode = 'controlled'
    s.ball.pos = { x: 1, y: -5.4 }
    s.ball.vel = { x: 0, y: 0 }
    s.ball.lastTouchTeam = 0
    s.ball.keeperRetouchId = null
    s.possessionTeam = 0
    sim.pass(fixo, { x: gk.pos.x - fixo.pos.x, y: gk.pos.y - fixo.pos.y }, false, gk)
    expect(s.ball.intendedReceiverId).toBe(0)
    const startY = gk.pos.y
    let moved = 0
    for (let i = 0; i < TICK_RATE * 3 && s.ball.ownerId !== 0; i++) {
      sim.step()
      moved = Math.max(moved, gk.pos.y - startY) // team 0 defends -y: towards the ball is +y
    }
    expect(s.ball.ownerId).toBe(0)
    expect(moved).toBeGreaterThan(1.5)
    expect(s.ball.inHands).toBe(false) // teammate's pass: feet
  })

  it('the human controls his keeper with the ball at the feet and can pass normally', () => {
    const { sim, s } = backPass(5, 0)
    expect(s.controlledId).toBe(0)
    sim.step([{ type: 'Pass', dir: { x: 1, y: 1 }, through: false }])
    expect(s.ball.ownerId).toBeNull()
    expect(s.ball.lastTouchId).toBe(0)
  })

  it('opponents go for the ball when the keeper has it at his feet, and can win it', () => {
    const { sim, s } = backPass(6, 0)
    // An opponent a few metres away; the human keeper just stands on the ball.
    const opp = sim.player(9)
    opp.pos = { x: 1.5, y: -12 }
    let won = false
    let closest = Infinity
    for (let i = 0; i < TICK_RATE * 3.5 && !won; i++) {
      sim.step()
      closest = Math.min(closest, Math.hypot(opp.pos.x - s.ball.pos.x, opp.pos.y - s.ball.pos.y))
      won = s.ball.lastTouchTeam === 1
    }
    expect(closest).toBeLessThan(0.7)
    expect(won).toBe(true)
  })

  it('four-second rule also applies with the ball at the feet (human keeper)', () => {
    const { sim, s } = backPass(6, 0)
    let timeout = false
    for (let i = 0; i < TICK_RATE * (HANDS.holdLimit + 1) && !timeout; i++) {
      // Keep the opponents away so nobody wins the ball before the four seconds are up.
      for (const o of s.players) if (o.team === 1 && o.role !== 'GK') o.pos = { x: o.id % 2 ? 8 : -8, y: 10 }
      sim.step()
      timeout = sim.drainEvents().some((e) => e.type === 'KeeperHoldTimeout')
    }
    expect(timeout).toBe(true)
  })

  it('second-possession rule: after playing it in the own half, the keeper may not take it back before an opponent touches it', () => {
    const { sim, s, gk } = backPass(7, null)
    // Keeper plays it out...
    sim.pass(gk, { x: 0, y: 1 }, false, sim.player(1))
    expect(s.ball.keeperRetouchId).toBe(0)
    // ...the teammate cannot simply give it back to him: a rolling return ball is not controlled.
    s.ball.pos = { x: gk.pos.x, y: gk.pos.y + 1.2 }
    s.ball.vel = { x: 0, y: -2 }
    s.ball.lastTouchTeam = 0
    s.ball.lastTouchId = 1
    gk.touchCooldown = 0
    for (let i = 0; i < 40; i++) {
      sim.step()
      expect(s.ball.ownerId).not.toBe(0)
    }
    // Assisted passing does not offer the banned keeper as a receiver either.
    const fixo = sim.player(1)
    fixo.pos = { x: 0, y: -10 }
    expect(chooseReceiver(s, fixo, { x: gk.pos.x - fixo.pos.x, y: gk.pos.y - fixo.pos.y })?.id).not.toBe(0)
    // Once an opponent has touched the ball the keeper may play it again.
    const opp = sim.player(9)
    sim.state.ball.keeperRetouchId = 0
    ;(sim as unknown as { updateKeeperRetouch(p: unknown): void }).updateKeeperRetouch(opp)
    expect(s.ball.keeperRetouchId).toBeNull()
  })
})
