import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { MatchSimulation } from '../../src/simulation/MatchSimulation'
import { TICK_RATE } from '../../src/simulation/SimulationConfig'
import type { Vec2 } from '../../src/core/math/vec2'

function openPlay(seed: number, humanTeam: 0 | null = null) {
  const sim = new MatchSimulation({ seed, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam })
  const s = sim.state
  for (let i = 0; i < 600 && !s.restart?.ready; i++) sim.step()
  for (let i = 0; i < 120 && s.phase !== 'play'; i++) sim.step()
  return { sim, s }
}

describe('pivot in the defensive diamond', () => {
  /** Team 1's fixo (6) carries the ball deep in his own half; who of team 0 presses him? */
  function pressers(backToGoal: boolean): Set<string> {
    const { sim, s } = openPlay(4)
    s.phase = 'play'
    s.restart = null
    const dir1 = s.teams[1].attackDir
    const spot: Vec2 = { x: 2, y: -dir1 * 9 }
    const c = sim.player(6)
    const seen = new Set<string>()
    for (let i = 0; i < TICK_RATE * 3; i++) {
      c.pos = { ...spot }
      c.vel = { x: 0, y: 0 }
      // Facing the goal he attacks, or with his back to it (facing his own goal).
      c.facing = (backToGoal ? -dir1 : dir1) === 1 ? Math.PI / 2 : -Math.PI / 2
      s.ball.ownerId = 6
      s.ball.mode = 'controlled'
      s.ball.pos = { x: spot.x, y: spot.y + dir1 * 0.4 }
      s.ball.vel = { x: 0, y: 0 }
      s.possessionTeam = 1
      sim.step()
      if (i > TICK_RATE)
        for (const q of s.players) if (q.team === 0 && q.aiState === 'press') seen.add(q.role)
    }
    return seen
  }

  it('the alas press a carrier facing forward; the pivot keeps the middle', () => {
    const seen = pressers(false)
    expect(seen.size).toBeGreaterThan(0)
    expect(seen.has('PIVOT')).toBe(false)
  })

  it('a carrier with his back to the goal he attacks is pressed by the pivot', () => {
    expect(pressers(true).has('PIVOT')).toBe(true)
  })

  it('while marking, the pivot does not follow the ball out to the wing', () => {
    const { sim, s } = openPlay(5)
    s.phase = 'play'
    s.restart = null
    const dir1 = s.teams[1].attackDir
    const c = sim.player(7)
    let maxX = 0
    for (let i = 0; i < TICK_RATE * 4; i++) {
      const spot = { x: 8.5, y: -dir1 * 6 }
      c.pos = { ...spot }
      c.vel = { x: 0, y: 0 }
      c.facing = dir1 === 1 ? Math.PI / 2 : -Math.PI / 2
      s.ball.ownerId = 7
      s.ball.mode = 'controlled'
      s.ball.pos = { x: spot.x, y: spot.y + dir1 * 0.4 }
      s.possessionTeam = 1
      sim.step()
      const pivot = sim.player(4)
      if (i > TICK_RATE * 2 && pivot.aiState === 'cover') maxX = Math.max(maxX, Math.abs(pivot.aiTarget.x))
    }
    expect(maxX).toBeLessThanOrEqual(3.5)
  })
})

describe('kick-off', () => {
  it('the human taker cannot walk away from the ball before the kick', () => {
    const sim = new MatchSimulation({ seed: 3, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: 0 })
    const s = sim.state
    expect(s.restart?.type).toBe('kickoff')
    const taker = sim.player(s.restart!.takerId)
    let maxDist = 0
    for (let i = 0; i < TICK_RATE * 2.5 && s.phase === 'restart'; i++) {
      // Hold "left" all the time.
      sim.step(
        s.controlledId === taker.id
          ? [{ type: 'Move', dir: { x: -1, y: 0 }, sprint: true, sole: false }]
          : [],
      )
      if (i > TICK_RATE * 1.2) maxDist = Math.max(maxDist, Math.hypot(taker.pos.x, taker.pos.y))
    }
    expect(maxDist).toBeLessThan(1)
  })
})

describe('goalkeeper facing', () => {
  it('after conceding the keeper turns to face the court, not the ball in his net', () => {
    const { sim, s } = openPlay(6)
    const gk = sim.player(5)
    const dir1 = s.teams[1].attackDir
    // A shot from close range straight into team 1's goal past the keeper.
    s.phase = 'play'
    s.restart = null
    gk.pos = { x: 1.5, y: -dir1 * 19 }
    const shooter = sim.player(2)
    shooter.pos = { x: -1, y: -dir1 * 15 }
    s.ball.ownerId = null
    s.ball.mode = 'free'
    s.ball.pos = { x: -1, y: -dir1 * 17 }
    s.ball.vel = { x: 0, y: -dir1 * 20 }
    s.ball.z = 0.2
    s.ball.vz = 0
    s.ball.isShot = true
    let goal = false
    for (let i = 0; i < TICK_RATE * 3; i++) {
      sim.step()
      if ((s.phase as string) === 'goal') goal = true
      if (goal && i > TICK_RATE * 2) break
    }
    expect(goal).toBe(true)
    // Facing out towards the court (team 1 attacks dir1: the court is that way from his goal).
    expect(Math.sin(gk.facing) * dir1).toBeGreaterThan(0.3)
  })
})
