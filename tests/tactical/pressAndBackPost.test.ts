import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { createInitialState } from '../../src/simulation/MatchSimulation'
import { carrierOptions, pickHelper, steer, updatePressTriggers } from '../../src/ai/BasicAI'
import { predictPassTarget } from '../../src/physics/PassingPhysics'
import { SeededRandom } from '../../src/core/random/SeededRandom'
import type { MatchState } from '../../src/simulation/MatchState'

function scene(): { s: MatchState; dir: number } {
  const s = createInitialState({ seed: 7, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: null })
  s.phase = 'play'
  s.restart = null
  return { s, dir: s.teams[0].attackDir }
}

describe('pressing without leaving men free', () => {
  it('a pressing cue other than the touch line does not send a second man; men stay marked', () => {
    const { s, dir } = scene()
    s.possessionTeam = 1
    // Their carrier just received facing his own goal 20 m from our goal, in the middle.
    const c = s.players[9]!
    c.pos = { x: 0, y: 0 }
    c.facing = dir > 0 ? Math.PI / 2 : -Math.PI / 2
    c.aiHoldTimer = 0.2
    s.ball.ownerId = 9
    s.ball.mode = 'controlled'
    s.ball.pos = { ...c.pos }
    for (const id of [1, 2, 3, 4]) s.players[id]!.pos = { x: (id - 2.5) * 3, y: -dir * 4 }
    updatePressTriggers(s)
    expect(s.pressTrigger[0]?.kind).toBe('backToGoal')
    expect(pickHelper(s, 0, 4)).toBeNull()
  })

  it('a presser who is not goal-side of the carrier gets back between him and goal, not onto the ball', () => {
    const { s, dir } = scene()
    s.possessionTeam = 1
    const ownGoal = { x: 0, y: -dir * 20 }
    const c = s.players[9]!
    c.pos = { x: 0, y: -dir * 10 }
    c.vel = { x: 0, y: -dir * 4 } // driving at our goal
    s.ball.ownerId = 9
    s.ball.mode = 'controlled'
    s.ball.pos = { x: 0, y: -dir * 10.4 }
    const p = s.players[2]!
    p.pos = { x: 0.9, y: -dir * 9.6 } // level with him, a step to the side (not goal-side)
    p.aiState = 'press'
    p.aiTarget = { ...c.pos }
    steer(s, p)
    // He moves towards our goal (to get goal-side), not sideways onto the ball.
    const toGoal = { x: ownGoal.x - p.pos.x, y: ownGoal.y - p.pos.y }
    const l = Math.hypot(toGoal.x, toGoal.y)
    expect((p.moveIntent.x * toGoal.x + p.moveIntent.y * toGoal.y) / l).toBeGreaterThan(0.3)
  })
})

describe('passing into the stride', () => {
  it('the computer plays a teammate in full stride into his path; the human player to his feet', () => {
    const { s } = scene()
    const passer = s.players[1]!
    passer.pos = { x: -4, y: 0 }
    const r = s.players[2]!
    r.pos = { x: 4, y: 0 }
    r.vel = { x: 0, y: 6.5 } // sprinting up the court, not on a "run"
    r.aiState = 'support'
    const ai = predictPassTarget(passer, r, false, 1, true)
    const human = predictPassTarget(passer, r, false, 1, false)
    expect(ai.y).toBeGreaterThan(1.5)
    expect(human.y).toBeLessThanOrEqual(1.01)
  })
})

describe('the back post', () => {
  it('out wide near goal with a teammate at the back post, the ball across is the choice', () => {
    const { s, dir } = scene()
    s.possessionTeam = 0
    const goalY = dir * 20
    for (const p of s.players)
      if (p.role !== 'GK') p.pos = p.team === 0 ? { x: -9, y: -goalY * 0.5 } : { x: 9, y: -goalY * 0.6 }
    const c = s.players[2]!
    c.pos = { x: 5.5, y: goalY - dir * 9 }
    c.aiHoldTimer = 0.5
    s.players[3]!.pos = { x: -2, y: goalY - dir * 2.8 } // at the back post
    s.players[5]!.pos = { x: 1, y: goalY - dir * 0.6 } // their keeper on his near post side
    s.ball.ownerId = 2
    s.ball.mode = 'controlled'
    s.ball.pos = { ...c.pos }
    const options = carrierOptions(s, c, new SeededRandom(3), {
      open: true,
      pressure: 0,
      toGoal: Math.hypot(c.pos.x, c.pos.y - goalY),
      goal: { x: 0, y: goalY },
      nearest: null,
    })
    const best = options.reduce((a, b) => (b.utility > a.utility ? b : a))
    expect(best.kind).toBe('backPost')
  })
})
