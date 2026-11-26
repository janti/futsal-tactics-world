import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { MatchSimulation } from '../../src/simulation/MatchSimulation'
import type { Command } from '../../src/simulation/Commands'
import { pivotSupportSpot } from '../../src/ai/team/attacking'

/**
 * The human pivot receives 11 m out with his back to goal and the computer's fixo a metre behind
 * him; then he turns and drives at goal (plain), or first moves left and then turns right (feint).
 */
function run(seed: number, feint: boolean): 'turned' | 'stopped' {
  const sim = new MatchSimulation({ seed, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: 0 })
  const s = sim.state
  for (let i = 0; i < 600 && !s.restart?.ready; i++) sim.step()
  s.phase = 'play'
  s.restart = null
  const dir = s.teams[0].attackDir // team 0 attacks +dir; AI goal at y = dir*20
  for (const p of s.players) {
    p.vel = { x: 0, y: 0 }
    if (p.role !== 'GK') p.pos = p.team === 0 ? { x: -8, y: -dir * 5 } : { x: 8, y: -dir * 2 }
  }
  const piv = sim.player(4)
  piv.pos = { x: 0, y: dir * 11 }
  piv.facing = dir > 0 ? -Math.PI / 2 : Math.PI / 2 // back to goal
  const fixo = sim.player(6)
  fixo.pos = { x: 0, y: dir * 12.2 }
  fixo.facing = dir > 0 ? -Math.PI / 2 : Math.PI / 2
  s.ball.ownerId = 4
  s.ball.mode = 'controlled'
  s.ball.inHands = false
  s.ball.pos = { x: 0, y: dir * 10.6 }
  s.ball.vel = { x: 0, y: 0 }
  s.ball.z = 0
  s.possessionTeam = 0
  ;(sim as unknown as { setControlled(id: number): void }).setControlled(4)
  for (let i = 0; i < 120; i++) {
    let cmd: Command
    if (i < 30) cmd = { type: 'Move', dir: { x: 0, y: 0 }, sprint: false, sole: true }
    else if (feint && i < 52) cmd = { type: 'Move', dir: { x: -1, y: 0 }, sprint: false, sole: false }
    else cmd = { type: 'Move', dir: { x: feint ? 0.8 : 0.5, y: dir }, sprint: true, sole: false }
    sim.step([cmd])
    if (s.ball.ownerId !== 4) return 'stopped'
    // Through: the pivot is goal-side of every outfield defender, within 9 m of goal.
    const toGoal = Math.hypot(piv.pos.x, piv.pos.y - dir * 20)
    const beaten = s.players
      .filter((q) => q.team === 1 && q.role !== 'GK')
      .every((q) => Math.hypot(q.pos.x, q.pos.y - dir * 20) > toGoal + 0.3)
    if (beaten && toGoal < 9) return 'turned'
  }
  return 'stopped'
}

describe('defending a pivot with his back to goal', () => {
  it('a plain turn is usually stopped; a feint one way and a turn the other often beats the defender', () => {
    let plain = 0
    let feint = 0
    for (let seed = 1; seed <= 20; seed++) {
      if (run(seed, false) === 'turned') plain++
      if (run(seed, true) === 'turned') feint++
    }
    expect(plain).toBeLessThanOrEqual(5)
    expect(feint).toBeGreaterThanOrEqual(6)
    expect(feint).toBeLessThan(20)
  }, 60000)
})

describe('supporting the pivot', () => {
  it('with space down a wing, a teammate carries his run on deep there while the pivot has the ball', () => {
    const sim = new MatchSimulation({
      seed: 2,
      home: TEAM_LIBRARY[0]!,
      away: TEAM_LIBRARY[1]!,
      humanTeam: null,
    })
    const s = sim.state
    s.phase = 'play'
    s.restart = null
    const dir = s.teams[0].attackDir
    for (const p of s.players)
      if (p.role !== 'GK') p.pos = p.team === 0 ? { x: -2, y: -dir * 6 } : { x: 0, y: dir * 14 }
    const piv = sim.player(4)
    piv.pos = { x: 0, y: dir * 8 }
    sim.player(2).pos = { x: -5, y: dir * 3 } // the left ala, a little behind the pivot
    sim.player(3).pos = { x: 5, y: dir * 2 }
    sim.player(6).pos = { x: 1, y: dir * 13 } // their defenders in the middle, wings free
    sim.player(7).pos = { x: -1, y: dir * 13 }
    sim.player(8).pos = { x: 0, y: dir * 11 }
    sim.player(9).pos = { x: 0, y: dir * 9.5 }
    s.ball.ownerId = 4
    s.ball.mode = 'controlled'
    s.ball.pos = { x: 0, y: dir * 8.4 }
    s.possessionTeam = 0
    const kinds = [2, 3].map((id) => pivotSupportSpot(s, sim.player(id))?.kind)
    expect(kinds).toContain('deep')
    const deepId = kinds[0] === 'deep' ? 2 : 3
    const spot = pivotSupportSpot(s, sim.player(deepId))!.spot
    // Deep down the wing, beyond the pivot, near the edge of the area.
    expect(Math.abs(spot.x)).toBeGreaterThan(5)
    expect((spot.y - piv.pos.y) * dir).toBeGreaterThan(5)
  })
})
