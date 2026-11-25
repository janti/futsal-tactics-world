import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { MatchSimulation } from '../../src/simulation/MatchSimulation'
import type { MatchEvent } from '../../src/simulation/Events'
import { TICK_RATE } from '../../src/simulation/SimulationConfig'

function aiSim(seed: number) {
  return new MatchSimulation({ seed, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: null })
}

/** Give team 0's fixo (id 1) the ball in open play and place players; returns the first pass by the carrier. */
function scenario(positions: Record<number, { x: number; y: number }>) {
  const sim = aiSim(11)
  const s = sim.state
  for (let i = 0; i < 600 && s.phase !== 'play'; i++) sim.step()
  for (const [id, pos] of Object.entries(positions)) {
    const p = sim.player(Number(id))
    p.pos = pos
    p.vel = { x: 0, y: 0 }
    p.aiTarget = { ...pos }
  }
  const carrier = sim.player(1)
  carrier.facing = Math.PI / 2
  carrier.aiHoldTimer = 0
  s.ball.ownerId = 1
  s.ball.mode = 'controlled'
  s.ball.pos = { x: carrier.pos.x, y: carrier.pos.y + 0.4 }
  s.ball.vel = { x: 0, y: 0 }
  s.ball.lastTouchTeam = 0
  s.ball.intendedReceiverId = null
  s.possessionTeam = 0
  sim.drainEvents()
  for (let i = 0; i < TICK_RATE * 3; i++) {
    sim.step()
    const pass = sim.drainEvents().find((e) => e.type === 'PassStarted' && e.playerId === 1) as
      Extract<MatchEvent, { type: 'PassStarted' }> | undefined
    if (pass) return { pass, tick: i, sim }
    if (s.ball.ownerId !== 1) return { pass: null, tick: i, sim }
  }
  return { pass: null, tick: -1, sim }
}

describe('AI direct play', () => {
  it('plays a quick forward pass to a teammate who is free in a scoring position', () => {
    // Team 0 attacks +y. Pivot (4) free 8 m from goal; opponents away from the lane.
    const { pass, tick } = scenario({
      1: { x: 0, y: -2 },
      4: { x: 2.5, y: 11 },
      2: { x: -6, y: 2 },
      3: { x: 6, y: 1 },
      6: { x: -7, y: 6 },
      7: { x: -8, y: -1 },
      8: { x: 8, y: -4 },
      9: { x: -4, y: -6 },
    })
    expect(pass?.receiverId).toBe(4)
    expect(tick).toBeLessThan(TICK_RATE * 0.8)
  })

  it('circulates the ball sideways or back when the forward option is closed', () => {
    // Pivot tightly marked with the lane blocked; the alas are free beside/behind the ball.
    const { pass, sim } = scenario({
      1: { x: 0, y: 0 },
      4: { x: 0, y: 10 },
      9: { x: 0, y: 9.2 },
      8: { x: 0, y: 4 },
      7: { x: 1.5, y: 2.6 },
      6: { x: -1.5, y: 2.6 },
      2: { x: -7, y: -1 },
      3: { x: 7, y: -1 },
    })
    expect(pass).not.toBeNull()
    const receiver = sim.player(pass!.receiverId!)
    expect(receiver.id).not.toBe(4)
    expect(receiver.pos.y).toBeLessThan(1.5)
  })

  it('AI vs AI: lively but controlled football (shots happen, most passes arrive, the ball is circulated)', () => {
    let shots = 0
    let passes = 0
    let completed = 0
    let circulation = 0
    for (const seed of [1, 2, 3]) {
      const sim = aiSim(seed)
      for (let i = 0; i < TICK_RATE * 180; i++) {
        sim.step()
        for (const e of sim.drainEvents()) {
          if (e.type === 'ShotTaken') shots++
          if (e.type === 'PassCompleted') completed++
          if (e.type === 'PassStarted' && e.receiverId !== null) {
            passes++
            const a = sim.player(e.playerId)
            const r = sim.player(e.receiverId)
            if ((r.pos.y - a.pos.y) * sim.state.teams[a.team].attackDir < 1.5) circulation++
          }
        }
      }
    }
    // Per 3 minutes of AI vs AI, averaged over three seeds.
    // Fewer, closer shots since long-range shooting was cut back (was > 6 when the AI shot from 15 m).
    expect(shots / 3).toBeGreaterThan(4.5)
    expect(completed / passes).toBeGreaterThan(0.75)
    expect(circulation / passes).toBeGreaterThan(0.35)
    expect(circulation / passes).toBeLessThan(0.85)
  })
})
