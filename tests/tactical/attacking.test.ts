import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { createInitialState } from '../../src/simulation/MatchSimulation'
import { backPostSpot, followUpTarget, runInBehind } from '../../src/ai/BasicAI'
import type { MatchState } from '../../src/simulation/MatchState'
import type { Vec2 } from '../../src/core/math/vec2'

/** Team 0 attacks +y. Ids: 1 fixo, 2 ala L, 3 ala R, 4 pivot; opponents 6..9. */
function setup(pos: Record<number, Vec2>, carrier: number | null): MatchState {
  const s = createInitialState({ seed: 4, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: null })
  s.phase = 'play'
  for (const p of s.players) {
    p.vel = { x: 0, y: 0 }
    p.pos = pos[p.id] ?? (p.team === 0 ? { x: 0, y: -15 } : { x: 0, y: 16 })
  }
  s.ball.ownerId = carrier
  s.ball.mode = carrier !== null ? 'controlled' : 'free'
  if (carrier !== null) s.ball.pos = { ...s.players[carrier]!.pos }
  s.possessionTeam = 0
  return s
}

describe('runs in behind', () => {
  const base: Record<number, Vec2> = {
    0: { x: 0, y: -19 },
    1: { x: 0, y: -6 }, // fixo deep
    2: { x: -3, y: -3 }, // ala L behind the ball
    3: { x: 6.5, y: -1 }, // ala R on the right wing
    4: { x: 0, y: 6 }, // pivot holding the ball up
    5: { x: 0, y: 19 },
    6: { x: 0, y: 9 },
    7: { x: -4, y: 8 },
    8: { x: 0, y: 4 },
    9: { x: -6, y: 10 },
  }

  it('the pivot holds the ball and the right wing is empty: the ala runs forward down the wing', () => {
    const s = setup(base, 4)
    s.players[4]!.aiHoldTimer = 1
    const target = runInBehind(s, s.players[3]!)
    expect(target).not.toBeNull()
    expect(target!.x).toBeGreaterThan(5)
    expect(target!.y).toBeGreaterThan(s.players[4]!.pos.y + 2) // beyond the ball
  })

  it('no run into a defender, nor when the carrier has just received it, nor by the deepest player', () => {
    const blocked = setup({ ...base, 9: { x: 7, y: 6 } }, 4)
    blocked.players[4]!.aiHoldTimer = 1
    expect(runInBehind(blocked, blocked.players[3]!)).toBeNull()
    const fresh = setup(base, 4)
    fresh.players[4]!.aiHoldTimer = 0.1
    expect(runInBehind(fresh, fresh.players[3]!)).toBeNull()
    const deep = setup(base, 4)
    deep.players[4]!.aiHoldTimer = 1
    expect(runInBehind(deep, deep.players[1]!)).toBeNull()
  })
})

describe('back post', () => {
  it('ball on a wing near goal: one attacker takes the back post', () => {
    const s = setup(
      { 0: { x: 0, y: -19 }, 1: { x: 0, y: -2 }, 2: { x: 7, y: 10 }, 3: { x: -2, y: 9 }, 4: { x: 1, y: 14 } },
      2,
    )
    const spots = [1, 3, 4].map((id) => backPostSpot(s, s.players[id]!))
    const takers = spots.filter((x) => x !== null)
    expect(takers).toHaveLength(1)
    expect(takers[0]!.x).toBeLessThan(-1) // the far side from the ball
    expect(takers[0]!.y).toBeGreaterThan(17)
  })

  it('after our shot the best placed attacker follows up at the far post for a tap-in', () => {
    const s = setup(
      { 0: { x: 0, y: -19 }, 1: { x: 0, y: -4 }, 2: { x: -4, y: 12 }, 3: { x: 5, y: 9 }, 4: { x: 2, y: 13 } },
      null,
    )
    s.ball.isShot = true
    s.ball.lastTouchTeam = 0
    s.ball.lastTouchId = 3
    s.ball.pos = { x: 4.5, y: 10 }
    s.ball.vel = { x: -2, y: 16 } // towards the right-hand post (seen from the shooter)
    const targets = [1, 2, 4].map((id) => followUpTarget(s, s.players[id]!))
    const runners = targets.filter((x) => x !== null)
    expect(runners).toHaveLength(1)
    expect(Math.abs(runners[0]!.x)).toBeGreaterThan(1)
    expect(runners[0]!.y).toBeGreaterThan(17)
    expect(followUpTarget(s, s.players[3]!)).toBeNull() // not the shooter
  })
})

describe('goal clearance shape', () => {
  it('the alas start a metre deeper than their attacking shape, for an easier angle out to the wing', async () => {
    const { MatchSimulation } = await import('../../src/simulation/MatchSimulation')
    const { dynamicAnchor } = await import('../../src/ai/positioning/Formation')
    const { GOAL_CLEARANCE_ALA_DROP } = await import('../../src/ai/BasicAI')
    const sim = new MatchSimulation({
      seed: 2,
      home: TEAM_LIBRARY[0]!,
      away: TEAM_LIBRARY[1]!,
      humanTeam: null,
    })
    const s = sim.state
    for (let i = 0; i < 600 && !s.restart?.ready; i++) sim.step()
    for (let i = 0; i < 120 && s.phase !== 'play'; i++) sim.step()
    const dir = s.teams[0].attackDir
    ;(sim as unknown as { beginRestart(t: string, team: number, spot: Vec2): void }).beginRestart(
      'goalClearance',
      0,
      {
        x: 0,
        y: -dir * 18.8,
      },
    )
    for (let i = 0; i < 20; i++) sim.step()
    expect(GOAL_CLEARANCE_ALA_DROP).toBe(1)
    for (const id of [2, 3]) {
      const p = sim.player(id)
      const shape = dynamicAnchor(p.role, 'attack', dir, s.restart!.spot)
      expect((shape.y - p.aiTarget.y) * dir).toBeCloseTo(1, 5)
    }
  })
})

describe('transition to defence', () => {
  it('losing the ball switches the whole team to defending at once and they sprint back', async () => {
    const { MatchSimulation } = await import('../../src/simulation/MatchSimulation')
    const sim = new MatchSimulation({
      seed: 3,
      home: TEAM_LIBRARY[0]!,
      away: TEAM_LIBRARY[1]!,
      humanTeam: null,
    })
    const s = sim.state
    for (let i = 0; i < 600 && !s.restart?.ready; i++) sim.step()
    for (let i = 0; i < 120 && s.phase !== 'play'; i++) sim.step()
    // Team 0 in possession high up, then team 1 wins it.
    const dir = s.teams[0].attackDir
    for (const p of s.players)
      if (p.team === 0 && p.role !== 'GK') p.pos = { x: (p.id - 2.5) * 3, y: dir * 8 }
    s.ball.ownerId = 4
    s.ball.mode = 'controlled'
    s.possessionTeam = 0
    sim.step()
    const thief = sim.player(7)
    thief.pos = { x: 0, y: dir * 6 }
    s.ball.ownerId = 7
    s.ball.pos = { x: 0, y: dir * 6 }
    s.possessionTeam = 1
    sim.step()
    const team0 = s.players.filter((p) => p.team === 0 && p.role !== 'GK')
    expect(team0.every((p) => p.aiRecoverTimer > 0)).toBe(true)
    expect(team0.every((p) => p.aiState === 'cover' || p.aiState === 'press' || p.aiState === 'chase')).toBe(
      true,
    )
    sim.step()
    expect(team0.some((p) => p.aiState === 'cover' && p.sprint)).toBe(true)
  })
})
