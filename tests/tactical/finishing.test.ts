import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { MatchSimulation } from '../../src/simulation/MatchSimulation'
import { TICK_RATE } from '../../src/simulation/SimulationConfig'

/** Team 1's player 7 on the ball at (x, y from goal) attacking team 0's goal; others out of the way. */
function setup(seed: number, x: number, fromGoal: number) {
  const sim = new MatchSimulation({ seed, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: null })
  const s = sim.state
  for (let i = 0; i < 600 && !s.restart?.ready; i++) sim.step()
  s.phase = 'play'
  s.restart = null
  const dir1 = s.teams[1].attackDir
  const goalY = dir1 * 20
  for (const p of s.players) {
    p.vel = { x: 0, y: 0 }
    if (p.role !== 'GK') p.pos = p.team === 0 ? { x: 9, y: -goalY * 0.5 } : { x: -9, y: -goalY * 0.5 }
  }
  const att = sim.player(7)
  att.pos = { x, y: goalY - dir1 * fromGoal }
  att.facing = dir1 > 0 ? Math.PI / 2 : -Math.PI / 2
  att.aiHoldTimer = 1
  s.ball.ownerId = 7
  s.ball.mode = 'controlled'
  s.ball.inHands = false
  s.ball.pos = { x, y: att.pos.y + dir1 * 0.4 }
  s.ball.vel = { x: 0, y: 0 }
  s.ball.lastTouchTeam = 1
  s.possessionTeam = 1
  return { sim, s, att, goalY, dir1 }
}

describe('finishing', () => {
  it('a first-time strike is not hit into a defender standing in the way', () => {
    const { sim, s, att, goalY, dir1 } = setup(2, 0, 9)
    att.aiSetPieceTimer = 1.5 // a lay-off / back-post ball to strike first time
    // Two defenders right in the line to goal.
    sim.player(1).pos = { x: -0.4, y: goalY - dir1 * 6.5 }
    sim.player(2).pos = { x: 0.5, y: goalY - dir1 * 6.8 }
    let shot = false
    for (let i = 0; i < 6; i++) {
      sim.step()
      if (sim.drainEvents().some((e) => e.type === 'ShotTaken')) shot = true
    }
    expect(shot).toBe(false)
    void s
  })

  it('through on goal with the keeper rushing out at him, he dinks it over the keeper', () => {
    let lobs = 0
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { sim, s, att, goalY, dir1 } = setup(seed, 1, 10)
      const gk = sim.player(0)
      gk.pos = { x: 0.8, y: goalY - dir1 * 7.2 } // well off his line, close to the attacker
      for (let i = 0; i < TICK_RATE; i++) {
        sim.step()
        const ev = sim.drainEvents()
        if (ev.some((e) => e.type === 'ShotTaken')) {
          if (att.aiDecision === 'lob' && s.ball.vz > 3) lobs++
          break
        }
      }
    }
    expect(lobs).toBeGreaterThanOrEqual(3)
  })
})
