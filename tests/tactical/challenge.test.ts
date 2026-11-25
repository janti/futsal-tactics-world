import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { MatchSimulation } from '../../src/simulation/MatchSimulation'
import { isLastMan } from '../../src/ai/BasicAI'
import { TICK_RATE } from '../../src/simulation/SimulationConfig'
import type { Vec2 } from '../../src/core/math/vec2'

/**
 * AI attacker (id 7, team 1, attacking -y) with the ball at `from`; one team-0 defender (id 2) is
 * 2.5 m goal-side of him, everyone else far away. Optionally a teammate (id 8) is deeper (so the
 * carrier is not the last man).
 */
function oneVsOne(seed: number, from: Vec2, lastMan: boolean) {
  const sim = new MatchSimulation({ seed, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: null })
  const s = sim.state
  for (let i = 0; i < 600 && !s.restart?.ready; i++) sim.step()
  for (let i = 0; i < 60 && s.phase !== 'play'; i++) sim.step()
  s.phase = 'play'
  s.restart = null
  for (const o of s.players) {
    o.vel = { x: 0, y: 0 }
    if (o.role === 'GK') continue
    // Teammates and other defenders well upfield/back, out of the duel.
    o.pos = o.team === 1 ? { x: (o.id - 7.5) * 4, y: from.y + 6 } : { x: (o.id - 2.5) * 4, y: from.y + 9 }
  }
  if (!lastMan) sim.player(8).pos = { x: -from.x * 0.5, y: from.y + 5 }
  else for (const t of s.players) if (t.team === 1 && t.role !== 'GK' && t.id !== 7) t.pos.y = from.y - 3
  const att = sim.player(7)
  att.pos = { ...from }
  att.facing = -Math.PI / 2
  const def = sim.player(2)
  def.pos = { x: from.x, y: from.y - 2.5 }
  def.facing = Math.PI / 2
  s.ball.ownerId = 7
  s.ball.mode = 'controlled'
  s.ball.pos = { x: from.x, y: from.y - 0.4 }
  s.ball.vel = { x: 0, y: 0 }
  s.ball.z = 0
  s.ball.lastTouchTeam = 1
  s.ball.lastTouchId = 7
  s.possessionTeam = 1
  sim.drainEvents()
  const wasLastMan = isLastMan(s, att)
  let challenged = false
  let beaten = false
  let lost = false
  for (let i = 0; i < TICK_RATE * 3 && !lost && !beaten; i++) {
    sim.step()
    if (att.aiState === 'challenge') challenged = true
    if (s.ball.ownerId !== 7 && s.ball.ownerId !== null)
      lost = s.ball.ownerId === 2 || sim.player(s.ball.ownerId).team === 0
    if (s.ball.ownerId === null && (s.ball.lastTouchTeam as number) === 0) lost = true
    if (challenged && s.ball.ownerId === 7 && (def.pos.y - att.pos.y) * -1 < -1) beaten = true
  }
  return { challenged, beaten, lost, lastMan: wasLastMan }
}

describe('AI 1v1 dribble challenge', () => {
  it('wingers and central players take the defender on, sometimes beating him', () => {
    let challenged = 0
    let beaten = 0
    const n = 30
    for (let seed = 1; seed <= n; seed++) {
      const x = seed % 3 === 0 ? 0 : seed % 3 === 1 ? 7 : -7
      const r = oneVsOne(seed, { x, y: -4 }, false)
      if (r.challenged) challenged++
      if (r.beaten) beaten++
    }
    console.log('1v1', { challenged, beaten, n })
    expect(challenged).toBeGreaterThan(n * 0.4)
    expect(beaten).toBeGreaterThan(challenged * 0.25)
    expect(beaten).toBeLessThan(challenged * 0.9)
  })

  it('the last man never takes players on', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const r = oneVsOne(seed, { x: seed % 2 ? 0 : 6, y: -4 }, true)
      expect(r.lastMan).toBe(true)
      expect(r.challenged).toBe(false)
    }
  })
})
