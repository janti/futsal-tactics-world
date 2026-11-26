import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { MatchSimulation, createInitialState } from '../../src/simulation/MatchSimulation'
import { chooseReceiver } from '../../src/physics/PassingPhysics'
import { PLAYER, TICK_RATE } from '../../src/simulation/SimulationConfig'
import type { Vec2 } from '../../src/core/math/vec2'

/** Team 0's player 1 on the ball at (0, -8); everybody else out of the way. */
function setup(seed = 3) {
  const sim = new MatchSimulation({ seed, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: 0 })
  const s = sim.state
  for (let i = 0; i < 600 && !s.restart?.ready; i++) sim.step()
  s.phase = 'play'
  s.restart = null
  const dir = s.teams[0].attackDir
  for (const p of s.players) {
    p.vel = { x: 0, y: 0 }
    if (p.role !== 'GK') p.pos = p.team === 0 ? { x: -9, y: -dir * 18 } : { x: 9, y: dir * 18 }
  }
  const passer = sim.player(1)
  passer.pos = { x: 0, y: -dir * 8 }
  passer.facing = dir > 0 ? Math.PI / 2 : -Math.PI / 2
  s.ball.ownerId = 1
  s.ball.mode = 'controlled'
  s.ball.inHands = false
  s.ball.pos = { x: 0, y: -dir * 7.6 }
  s.ball.vel = { x: 0, y: 0 }
  s.ball.z = 0
  s.possessionTeam = 0
  ;(sim as unknown as { setControlled(id: number): void }).setControlled(1)
  return { sim, s, dir }
}

describe('charged ground passes', () => {
  it('a longer press picks the teammate further away in the same direction', () => {
    const s = createInitialState({ seed: 2, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: 0 })
    for (const p of s.players) p.pos = { x: p.team === 0 ? -9 : 9, y: p.team === 0 ? -18 : 18 }
    const passer = s.players[1]!
    passer.pos = { x: 0, y: 0 }
    s.players[2]!.pos = { x: 5, y: 0.3 }
    s.players[3]!.pos = { x: 14, y: -0.4 }
    expect(chooseReceiver(s, passer, { x: 1, y: 0 }, undefined, 0)?.id).toBe(2)
    expect(chooseReceiver(s, passer, { x: 1, y: 0 }, undefined, 1)?.id).toBe(3)
  })

  it('a longer press plays the pass firmer, always along the floor', () => {
    const speed = (power: number) => {
      const { sim, s, dir } = setup()
      sim.player(2).pos = { x: 0, y: dir * 2 }
      sim.step([{ type: 'Pass', dir: { x: 0, y: dir }, through: false, power }])
      expect(s.ball.vz).toBe(0)
      expect(s.ball.z).toBe(0)
      return Math.hypot(s.ball.vel.x, s.ball.vel.y)
    }
    expect(speed(1)).toBeGreaterThan(speed(0) + 3)
  })

  it('a teammate controls a firm pass cleanly; striking an opponent it usually bounces off him', () => {
    let teammate = 0
    let opponentBounced = 0
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const team of [0, 1] as const) {
        const { sim, s, dir } = setup(seed)
        const r = sim.player(team === 0 ? 2 : 7)
        r.pos = { x: 0, y: dir * 3 }
        r.facing = dir > 0 ? -Math.PI / 2 : Math.PI / 2
        r.touchCooldown = 0
        s.ball.ownerId = null
        s.ball.mode = 'free'
        s.ball.pos = { x: 0, y: -dir * 5 }
        s.ball.vel = { x: 0, y: dir * 12 } // a firm pass
        s.ball.lastTouchTeam = 0
        s.ball.lastTouchId = 1
        s.ball.lastKickerId = 1
        s.ball.isShot = false
        s.ball.intendedReceiverId = team === 0 ? 2 : null
        for (let i = 0; i < 60; i++) {
          sim.step()
          if (s.ball.ownerId === r.id) {
            if (team === 0) teammate++
            break
          }
          if (team === 1 && s.ball.lastTouchId === r.id && s.ball.ownerId === null) {
            opponentBounced++
            break
          }
        }
      }
    }
    expect(teammate).toBeGreaterThanOrEqual(7)
    expect(opponentBounced).toBeGreaterThanOrEqual(3)
  })
})

describe('chip (the old through-pass key)', () => {
  /** Chip with `power` along +attack direction; returns the max height and where it first lands. */
  function chip(power: number, opponentAt?: number) {
    const { sim, s, dir } = setup()
    if (opponentAt !== undefined) {
      const o = sim.player(7)
      o.pos = { x: 0, y: -dir * 7.6 + dir * opponentAt }
    }
    sim.step([{ type: 'Pass', dir: { x: 0, y: dir }, through: false, power, chip: true }])
    let maxZ = 0
    let landed: Vec2 | null = null
    let zAtOpponent = -1
    let air = 0
    const from = -dir * 7.6
    for (let i = 0; i < TICK_RATE * 3 && !landed; i++) {
      sim.step()
      maxZ = Math.max(maxZ, s.ball.z)
      if (s.ball.z > 0.001) air++
      const along = (s.ball.pos.y - from) * dir
      // Height as it reaches his feet (half a metre in front of him).
      if (opponentAt !== undefined && zAtOpponent < 0 && along >= opponentAt - 0.5) zAtOpponent = s.ball.z
      if (i > 3 && s.ball.z <= 0.001) landed = { ...s.ball.pos }
    }
    return { maxZ, landedAt: landed ? (landed.y - from) * dir : 0, zAtOpponent, airTime: air / TICK_RATE }
  }

  it('a dink: a tap lifts it just over a leg; a full press goes high but not far, and slowly', () => {
    const tap = chip(0)
    const full = chip(1)
    expect(tap.maxZ).toBeGreaterThan(0.9)
    expect(tap.maxZ).toBeLessThan(1.8)
    expect(tap.landedAt).toBeLessThan(4.5)
    expect(full.maxZ).toBeGreaterThan(4.5)
    expect(full.landedAt).toBeGreaterThan(8)
    expect(full.landedAt).toBeLessThan(14)
    // Slow: in the air for about two seconds.
    expect(full.airTime).toBeGreaterThan(1.7)
  })

  it('a quick chip goes over the leg of an opponent close in front (above his reach with the foot)', () => {
    const r = chip(0, 1.4)
    expect(r.zAtOpponent).toBeGreaterThan(PLAYER.ballContactHeight)
  })
})

describe('keeper distribution', () => {
  it('the AI keeper throws a longer ball in an arc', () => {
    let arcs = 0
    let throws = 0
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const sim = new MatchSimulation({
        seed,
        home: TEAM_LIBRARY[0]!,
        away: TEAM_LIBRARY[1]!,
        humanTeam: null,
      })
      const s = sim.state
      for (let i = 0; i < TICK_RATE * 120; i++) {
        sim.step()
        for (const e of sim.drainEvents())
          if (e.type === 'KeeperThrow') {
            throws++
            if (s.ball.vz > 2) arcs++
          }
      }
    }
    expect(throws).toBeGreaterThan(3)
    expect(arcs).toBeGreaterThan(0)
  }, 60000)
})
