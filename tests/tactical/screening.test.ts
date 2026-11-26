import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { MatchSimulation, isLongRangeShot } from '../../src/simulation/MatchSimulation'
import type { Vec2 } from '../../src/core/math/vec2'

type Outcome = 'goal' | 'saved' | 'out' | 'other'

/**
 * Human attacker (team 0, attacking +y) shoots from `from` at full power to a corner. Keeper id 5
 * defends y = +20. Optionally one player stands in the keeper's line of sight ("maski").
 */
function shot(seed: number, from: Vec2, screen: boolean): { outcome: Outcome; caught: boolean } {
  const sim = new MatchSimulation({ seed, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: 0 })
  const s = sim.state
  for (let i = 0; i < 600 && !s.restart?.ready; i++) sim.step()
  sim.step([{ type: 'Pass', dir: { x: 0, y: -1 }, through: false }])
  for (let i = 0; i < 60; i++) sim.step()
  s.phase = 'play'
  s.restart = null
  const shooter = sim.player(4)
  const gk = sim.player(5)
  const park = () => {
    for (const o of s.players) if (o.id !== 4 && o.role !== 'GK') o.pos = { x: o.id % 2 ? 9.5 : -9.5, y: -6 }
    if (screen) {
      // A defender 2.2 m in front of the keeper, on the line between the ball and the keeper.
      const dx = gk.pos.x - from.x
      const dy = gk.pos.y - from.y
      const l = Math.hypot(dx, dy)
      const scr = sim.player(7)
      scr.pos = {
        x: gk.pos.x - (dx / l) * 2.2 + (dy / l) * 0.25,
        y: gk.pos.y - (dy / l) * 2.2 - (dx / l) * 0.25,
      }
      scr.vel = { x: 0, y: 0 }
    }
  }
  s.controlledId = 4
  shooter.pos = { ...from }
  shooter.vel = { x: 0, y: 0 }
  shooter.facing = Math.atan2(20 - from.y, -from.x)
  s.ball.ownerId = 4
  s.ball.mode = 'controlled'
  s.ball.pos = { x: from.x, y: from.y + 0.4 }
  s.ball.vel = { x: 0, y: 0 }
  s.possessionTeam = 0
  for (let i = 0; i < 60; i++) {
    park()
    sim.step([{ type: 'Move', dir: { x: 0, y: 0 }, sprint: false, sole: true }])
    s.ball.ownerId = 4
  }
  park()
  sim.drainEvents()
  sim.step([{ type: 'Shoot', dir: { x: seed % 2 ? 1 : -1, y: 1 }, power: 0.55 }])
  let caught = false
  for (let i = 0; i < 240; i++) {
    // Keep the screen in place (the AI would otherwise move it).
    if (screen && i < 20) {
      const scr = sim.player(7)
      scr.vel = { x: 0, y: 0 }
    }
    sim.step()
    if (s.ball.ownerId === 5 && s.ball.inHands) caught = true
    for (const e of sim.drainEvents()) {
      if (e.type === 'GoalScored') return { outcome: 'goal', caught }
      if (e.type === 'Save') return { outcome: 'saved', caught: e.caught || caught }
      if (e.type === 'PossessionChanged' && e.team === 1) return { outcome: 'saved', caught: s.ball.inHands }
      if (e.type === 'BallOut') return { outcome: 'out', caught }
    }
  }
  return { outcome: 'other', caught }
}

function tally(from: Vec2, screen: boolean, seeds = 30) {
  const t = { goal: 0, saved: 0, out: 0, other: 0, caught: 0 }
  for (let seed = 1; seed <= seeds; seed++) {
    const r = shot(seed, from, screen)
    t[r.outcome]++
    if (r.caught) t.caught++
  }
  return t
}

describe('long-range shots and screening ("maski")', () => {
  const longRange: Vec2[] = [
    { x: 0, y: 8 }, // 12 m, central
    { x: 3.5, y: 9 }, // ~11.5 m, half-left
  ]
  const tightAngle: Vec2 = { x: 8.5, y: 17.5 } // from the wing, close to the goal line

  it('classifies 10 m+ and tight-angle shots as long range, close central shots not', () => {
    for (const p of longRange) expect(isLongRangeShot(p, 1)).toBe(true)
    expect(isLongRangeShot(tightAngle, 1)).toBe(true)
    expect(isLongRangeShot({ x: 0, y: 13 }, 1)).toBe(false) // 7 m central
  })

  it('without a screen the keeper deals with almost every long-range or tight-angle shot', () => {
    for (const from of [...longRange, tightAngle]) {
      const t = tally(from, false)
      expect(t.goal).toBeLessThanOrEqual(2) // <= ~7 %
      expect(t.saved).toBeGreaterThan(15)
    }
  })

  it('without a screen most long shots that reach the keeper are caught, not parried', () => {
    const t = tally(longRange[0]!, false)
    expect(t.caught).toBeGreaterThan(t.saved * 0.5)
  })

  it('a screen in front of the keeper makes long-range shots go in clearly more often', () => {
    let clear = 0
    let screened = 0
    for (const from of longRange) {
      clear += tally(from, false).goal
      screened += tally(from, true).goal
    }
    expect(screened).toBeGreaterThanOrEqual(clear + 5)
  })
})

describe('shots from the side (outside the arc)', () => {
  /** Human shot from the right side just outside the penalty-area arc, aimed at the near post. */
  function side(seed: number, power: number) {
    const sim = new MatchSimulation({ seed, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: 0 })
    const s = sim.state
    for (let i = 0; i < 600 && !s.restart?.ready; i++) sim.step()
    sim.step([{ type: 'Pass', dir: { x: 0, y: -1 }, through: false }])
    for (let i = 0; i < 60; i++) sim.step()
    s.phase = 'play'
    s.restart = null
    const from = { x: 6.2, y: 15 }
    const sh = sim.player(4)
    const park = () => {
      for (const o of s.players) if (o.id !== 4 && o.role !== 'GK') o.pos = { x: o.id % 2 ? -9.5 : -9, y: -6 }
    }
    s.controlledId = 4
    sh.pos = { ...from }
    sh.vel = { x: 0, y: 0 }
    sh.facing = Math.atan2(20 - from.y, -from.x)
    Object.assign(s.ball, {
      ownerId: 4,
      mode: 'controlled',
      pos: { x: from.x, y: from.y + 0.4 },
      vel: { x: 0, y: 0 },
    })
    s.possessionTeam = 0
    for (let i = 0; i < 60; i++) {
      park()
      sim.step([{ type: 'Move', dir: { x: 0, y: 0 }, sprint: false, sole: true }])
      s.ball.ownerId = 4
    }
    park()
    sim.drainEvents()
    sim.step([{ type: 'Shoot', dir: { x: 1, y: 1 }, power }]) // lateral +x: the near post
    for (let i = 0; i < 180; i++) {
      sim.step()
      for (const e of sim.drainEvents()) {
        if (e.type === 'GoalScored') return 'goal'
        if (e.type === 'Save' || e.type === 'BallOut') return 'no'
      }
    }
    return 'no'
  }

  it('the keeper covers his near post: low and mid shots are almost all saved', () => {
    let goals = 0
    for (let seed = 1; seed <= 30; seed++) if (side(seed, 0.3) === 'goal') goals++
    for (let seed = 1; seed <= 30; seed++) if (side(seed, 0.5) === 'goal') goals++
    expect(goals).toBeLessThanOrEqual(4)
  })

  it('a ball into the near top corner still beats him sometimes', () => {
    let goals = 0
    for (let seed = 1; seed <= 30; seed++) if (side(seed, 0.8) === 'goal') goals++
    expect(goals).toBeGreaterThan(3)
  })
})

describe('keeper narrowing the angle on a free shooting chance', () => {
  /** Human holds the ball free 8 m out for a second, then shoots; returns outcome and keeper depth. */
  function freeShot(seed: number, power: number) {
    const sim = new MatchSimulation({ seed, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: 0 })
    const s = sim.state
    for (let i = 0; i < 600 && !s.restart?.ready; i++) sim.step()
    sim.step([{ type: 'Pass', dir: { x: 0, y: -1 }, through: false }])
    for (let i = 0; i < 60; i++) sim.step()
    s.phase = 'play'
    s.restart = null
    const from = { x: 0.5, y: 12 }
    const sh = sim.player(4)
    const park = () => {
      for (const o of s.players) if (o.id !== 4 && o.role !== 'GK') o.pos = { x: o.id % 2 ? -9.5 : -9, y: -6 }
    }
    s.controlledId = 4
    sh.pos = { ...from }
    sh.vel = { x: 0, y: 0 }
    sh.facing = Math.PI / 2
    Object.assign(s.ball, {
      ownerId: 4,
      mode: 'controlled',
      pos: { x: from.x, y: from.y + 0.4 },
      vel: { x: 0, y: 0 },
    })
    s.possessionTeam = 0
    for (let i = 0; i < 60; i++) {
      park()
      sim.step([{ type: 'Move', dir: { x: 0, y: 0 }, sprint: false, sole: true }])
      s.ball.ownerId = 4
    }
    park()
    const out = 20 - sim.player(5).pos.y
    sim.drainEvents()
    sim.step([{ type: 'Shoot', dir: { x: seed % 2 ? 1 : -1, y: 1 }, power }])
    for (let i = 0; i < 180; i++) {
      sim.step()
      for (const e of sim.drainEvents()) {
        if (e.type === 'GoalScored') return { goal: true, out }
        if (e.type === 'Save' || e.type === 'BallOut') return { goal: false, out }
      }
    }
    return { goal: false, out }
  }

  it('he comes off his line to narrow the angle, but not rushing right up to the shooter', () => {
    const r = freeShot(3, 0.3)
    expect(r.out).toBeGreaterThan(1.6)
    expect(r.out).toBeLessThan(3)
  })

  it('he is not a wall: well-placed shots still score often', () => {
    let goals = 0
    for (let seed = 1; seed <= 30; seed++) if (freeShot(seed, 0.3).goal) goals++
    expect(goals).toBeGreaterThan(12) // > 40 %
    expect(goals).toBeLessThan(23) // but fewer than the ~77 % with the keeper on his line
  })
})
