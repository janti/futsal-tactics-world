import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { MatchSimulation } from '../../src/simulation/MatchSimulation'
import type { Command } from '../../src/simulation/Commands'

/**
 * A crude "human" for team 0: chases the ball and steps into passes (aiming a little ahead of the
 * ball), carries forward, passes now and then and shoots near goal. Restarts are left to the game.
 */
function botCommands(sim: MatchSimulation): Command[] {
  const s = sim.state
  const id = s.controlledId
  if (id === null) return []
  const p = sim.player(id)
  const b = s.ball
  const dir = s.teams[0].attackDir
  if (s.restart?.ready && s.restart.team === 0 && s.restart.takerId === id)
    return [{ type: 'Pass', dir: { x: 0, y: dir }, through: false }]
  if (s.phase === 'restart') return []
  if (b.ownerId === id) {
    if (b.inHands) return [{ type: 'Throw', dir: { x: 0.3, y: dir }, power: 0.6 }]
    const toGoal = Math.hypot(p.pos.x, p.pos.y - dir * 20)
    if (toGoal < 9) return [{ type: 'Shoot', dir: { x: p.pos.x > 0 ? -1 : 1, y: dir }, power: 0.3 }]
    if ((s.tick + id) % 40 === 0) return [{ type: 'Pass', dir: { x: 0, y: dir }, through: false }]
    return [{ type: 'Move', dir: { x: 0, y: dir }, sprint: false, sole: false }]
  }
  const tx = b.pos.x + b.vel.x * 0.35 - p.pos.x
  const ty = b.pos.y + b.vel.y * 0.35 - p.pos.y
  const l = Math.hypot(tx, ty) || 1
  return [{ type: 'Move', dir: { x: tx / l, y: ty / l }, sprint: true, sole: false }]
}

describe('AI against a human-like player', () => {
  it('the AI does not keep passing the ball straight to the human player', () => {
    let aiPasses = 0
    let cut = 0
    for (const seed of [1, 2, 3]) {
      const sim = new MatchSimulation({ seed, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: 0 })
      const s = sim.state
      let pending = false
      for (let i = 0; i < 150 * 60; i++) {
        sim.step(botCommands(sim))
        for (const e of sim.drainEvents()) {
          if (e.type === 'PassStarted' && e.receiverId !== null && sim.player(e.playerId).team === 1) {
            aiPasses++
            pending = true
          }
          if (e.type === 'PassCompleted' && sim.player(e.playerId).team === 1) pending = false
        }
        if (pending && s.ball.ownerId !== null) {
          if (s.ball.ownerId === s.controlledId) cut++
          pending = false
        }
      }
    }
    expect(aiPasses).toBeGreaterThan(100)
    expect(cut / aiPasses).toBeLessThan(0.15)
  }, 120000)
})
