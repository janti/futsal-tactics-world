import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { MatchSimulation, createInitialState } from '../../src/simulation/MatchSimulation'
import { chooseReceiver } from '../../src/physics/PassingPhysics'
import { RESTART, TICK_RATE } from '../../src/simulation/SimulationConfig'
import type { Vec2 } from '../../src/core/math/vec2'

const d = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y)

function openPlay(seed: number) {
  const sim = new MatchSimulation({ seed, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: 0 })
  const s = sim.state
  for (let i = 0; i < 600 && !s.restart?.ready; i++) sim.step()
  s.phase = 'play'
  s.restart = null
  return { sim, s }
}

describe('pass assistance', () => {
  it('prefers an open teammate to a blocked one in the same direction', () => {
    const s = createInitialState({ seed: 2, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: 0 })
    for (const p of s.players) p.pos = { x: p.team === 0 ? -9 : 9, y: p.team === 0 ? -18 : 18 }
    const passer = s.players[1]!
    passer.pos = { x: 0, y: 0 }
    s.players[2]!.pos = { x: 6, y: 0.5 } // straight along the input, but an opponent is on the line
    s.players[6]!.pos = { x: 3, y: 0.4 }
    s.players[3]!.pos = { x: 6, y: 3.5 } // a little off the input, open lane
    const r = chooseReceiver(s, passer, { x: 1, y: 0 })
    expect(r?.id).toBe(3)
  })

  it('the controlled receiver goes to meet the pass even with the passing key still held', () => {
    const { sim, s } = openPlay(3)
    const dir = s.teams[0].attackDir
    const passer = sim.player(1)
    const recv = sim.player(2)
    for (const p of s.players) if (p.team === 1) p.pos = { x: 9, y: dir * 18 }
    passer.pos = { x: 0, y: -dir * 6 }
    recv.pos = { x: 6, y: -dir * 6 }
    recv.vel = { x: 0, y: 0 }
    s.ball.ownerId = 1
    s.ball.mode = 'controlled'
    s.ball.pos = { x: 0.4, y: -dir * 6 }
    s.possessionTeam = 0
    ;(sim as unknown as { setControlled(id: number): void }).setControlled(1)
    // Pass to the right, then keep holding "up the court" (as if the key for the next run is held).
    sim.step([{ type: 'Pass', dir: { x: 1, y: 0 }, through: false }])
    expect(s.controlledId).toBe(2)
    let got = false
    for (let i = 0; i < TICK_RATE * 2 && !got; i++) {
      sim.step([{ type: 'Move', dir: { x: 0, y: dir }, sprint: true, sole: false }])
      got = s.ball.ownerId === 2
    }
    expect(got).toBe(true)
  })
})

describe('restart distance', () => {
  it('the human player is walked out of the circle round a kick-in and cannot step back in', () => {
    const { sim, s } = openPlay(4)
    const spot = { x: 10, y: 2 }
    ;(sim as unknown as { beginRestart(t: string, team: number, spot: Vec2): void }).beginRestart(
      'kickIn',
      1,
      spot,
    )
    const human = sim.player(s.controlledId!)
    human.pos = { x: 9.3, y: 2.3 }
    let minD = Infinity
    for (let i = 0; i < TICK_RATE * 3 && s.phase === 'restart'; i++) {
      // Keep pushing towards the ball.
      const to = { x: spot.x - human.pos.x, y: spot.y - human.pos.y }
      sim.step([{ type: 'Move', dir: to, sprint: true, sole: false }])
      if (i > TICK_RATE * 1.2) minD = Math.min(minD, d(human.pos, spot))
    }
    expect(minD).toBeGreaterThan(RESTART.opponentDistance - 0.15)
  })

  it('during the opponents goal clearance the human player is walked out of their penalty area', () => {
    const { sim, s } = openPlay(5)
    const dir1 = s.teams[1].attackDir
    const clearSpot = { x: 0, y: -dir1 * 18.8 }
    ;(sim as unknown as { beginRestart(t: string, team: number, spot: Vec2): void }).beginRestart(
      'goalClearance',
      1,
      clearSpot,
    )
    for (let i = 0; i < TICK_RATE * 8 && !s.clearance; i++) sim.step()
    expect(s.clearance).not.toBeNull()
    const human = sim.player(s.controlledId!)
    human.pos = { x: 0.5, y: -dir1 * 16 } // inside their area
    for (let i = 0; i < TICK_RATE * 1.5 && s.clearance && !s.clearance.released; i++)
      sim.step([{ type: 'Move', dir: { x: 0, y: -dir1 }, sprint: true, sole: false }])
    // 6 m area radius from the goal line: he is out of it (or the throw has gone).
    expect(Math.abs(human.pos.y + dir1 * 20)).toBeGreaterThan(5.8)
  })
})

describe('AI carrier against a close opponent', () => {
  it('does not dribble into the human player in front of him: he shields and turns away', () => {
    const { sim, s } = openPlay(6)
    const dir1 = s.teams[1].attackDir
    const carrier = sim.player(7)
    carrier.pos = { x: 2, y: 0 }
    carrier.vel = { x: 0, y: 0 }
    carrier.facing = dir1 === 1 ? Math.PI / 2 : -Math.PI / 2
    s.ball.ownerId = 7
    s.ball.mode = 'controlled'
    s.ball.pos = { x: 2, y: dir1 * 0.4 }
    s.possessionTeam = 1
    const human = sim.player(s.controlledId!)
    human.pos = { x: 2, y: dir1 * 2.2 } // right in front of him, between him and goal
    human.vel = { x: 0, y: 0 }
    let closest = Infinity
    for (let i = 0; i < 20; i++) {
      sim.step([])
      if (s.ball.ownerId !== 7) break
      closest = Math.min(closest, d(carrier.pos, human.pos))
      // Moving towards the opponent at most slowly.
      const to = { x: human.pos.x - carrier.pos.x, y: human.pos.y - carrier.pos.y }
      const l = Math.hypot(to.x, to.y)
      expect((carrier.vel.x * to.x + carrier.vel.y * to.y) / l).toBeLessThan(1.2)
    }
    expect(closest).toBeGreaterThan(1)
  })
})

describe('passes to feet and receiving', () => {
  function sidewaysPass(receiverRun: number) {
    const sim = new MatchSimulation({ seed: 3, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: 0 })
    const s = sim.state
    for (let i = 0; i < 600 && !s.restart?.ready; i++) sim.step()
    s.phase = 'play'
    s.restart = null
    const dir = s.teams[0].attackDir
    for (const p of s.players) if (p.team === 1) p.pos = { x: 9, y: dir * 18 }
    const passer = sim.player(1)
    const recv = sim.player(2)
    passer.pos = { x: -3, y: -dir * 6 }
    passer.vel = { x: 0, y: dir * 4 }
    passer.facing = dir > 0 ? Math.PI / 2 : -Math.PI / 2
    recv.pos = { x: 5, y: -dir * 6 }
    recv.vel = { x: 0, y: dir * receiverRun }
    s.ball.ownerId = 1
    s.ball.mode = 'controlled'
    s.ball.pos = { x: -3, y: -dir * 5.4 }
    s.possessionTeam = 0
    ;(sim as unknown as { setControlled(id: number): void }).setControlled(1)
    const recvAtKick = { ...recv.pos }
    sim.step([{ type: 'Pass', dir: { x: 1, y: 0 }, through: false }])
    return { sim, s, dir, recv, recvAtKick }
  }

  it('a square pass goes straight to the receiver, not up the court in front of him', () => {
    const { s, dir, recvAtKick } = sidewaysPass(5)
    const v = s.ball.vel
    const toRecv = { x: recvAtKick.x - s.ball.pos.x, y: recvAtKick.y - s.ball.pos.y }
    const angle = Math.abs(Math.atan2(v.y, v.x) - Math.atan2(toRecv.y, toRecv.x))
    // At most the small capped lead (a metre over 8 m), not 20-30 degrees up the court.
    expect(angle).toBeLessThan((8.5 * Math.PI) / 180)
    void dir
  })

  it('the receiver steps towards the ball and never back-pedals away from it', () => {
    const { sim, s, recv } = sidewaysPass(0)
    let minTowards = Infinity
    for (let i = 0; i < 90 && s.ball.ownerId === null; i++) {
      sim.step([])
      const to = { x: s.ball.pos.x - recv.pos.x, y: s.ball.pos.y - recv.pos.y }
      const l = Math.hypot(to.x, to.y)
      if (l > 0.8) minTowards = Math.min(minTowards, (recv.vel.x * to.x + recv.vel.y * to.y) / l)
    }
    expect(s.ball.ownerId).toBe(2)
    expect(minTowards).toBeGreaterThan(-0.3)
  })
})
