import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { createInitialState } from '../../src/simulation/MatchSimulation'
import {
  PRESS_TRIGGER,
  pickBallWinner,
  pickHelper,
  pressEngageDistance,
  pressTriggerActive,
  updatePressTriggers,
} from '../../src/ai/BasicAI'
import type { MatchState } from '../../src/simulation/MatchState'
import type { PressingHeight } from '../../src/simulation/Tactics'

/**
 * Team 1 has the ball; team 0 defends (its goal at -dir * 20, so team 1 attacks towards it).
 * `ballY` is the ball's distance from team 0's goal line.
 */
function scene(pressing: PressingHeight = 'mid'): { s: MatchState; dir: number } {
  const s = createInitialState({
    seed: 3,
    home: TEAM_LIBRARY[0]!,
    away: TEAM_LIBRARY[1]!,
    humanTeam: null,
    tactics: [{ pressing }],
  })
  s.phase = 'play'
  s.restart = null
  const dir = s.teams[0].attackDir
  s.possessionTeam = 1
  return { s, dir }
}

/** Put team 1's player `id` on the ball at `x`, `fromGoal` metres from team 0's goal line. */
function carrier(s: MatchState, dir: number, id: number, x: number, fromGoal: number, facingOwnGoal = false) {
  const p = s.players[id]!
  p.pos = { x, y: -dir * (20 - fromGoal) }
  // Team 1 attacks -dir: facing its own goal is facing +dir.
  p.facing = (facingOwnGoal ? dir : -dir) > 0 ? Math.PI / 2 : -Math.PI / 2
  p.aiHoldTimer = 0.2
  s.ball.ownerId = id
  s.ball.mode = 'controlled'
  s.ball.pos = { ...p.pos }
  s.ball.vel = { x: 0, y: 0 }
  return p
}

describe('pressing triggers', () => {
  it('a back pass to their keeper sets the press on the receiver', () => {
    const { s, dir } = scene()
    const passer = s.players[7]!
    passer.pos = { x: 2, y: -dir * 2 }
    const gk = s.players[5]!
    gk.pos = { x: 0, y: dir * 19 }
    s.ball.ownerId = null
    s.ball.mode = 'free'
    s.ball.pos = { x: 1.5, y: dir * 5 } // on its way back to him, 25 m from our goal
    s.ball.vel = { x: -0.2, y: dir * 8 }
    s.ball.lastTouchTeam = 1
    s.ball.intendedReceiverId = 5
    updatePressTriggers(s)
    expect(s.pressTrigger[0]?.kind).toBe('backPass')
    expect(s.pressTrigger[0]?.targetId).toBe(5)
    expect(pressEngageDistance(s, 0)).toBeGreaterThan(40)
  })

  it('a carrier who has just received facing his own goal is a cue', () => {
    const { s, dir } = scene()
    carrier(s, dir, 9, 0, 14, true)
    updatePressTriggers(s)
    expect(s.pressTrigger[0]?.kind).toBe('backToGoal')
  })

  it('by the touch line a second man comes to trap him, even far from our goal', () => {
    const { s, dir } = scene()
    const c = carrier(s, dir, 8, 9.2, 26)
    for (const p of s.players) if (p.team === 0 && p.role !== 'GK') p.pos = { x: 5 - p.id, y: -dir * 2 }
    updatePressTriggers(s)
    expect(s.pressTrigger[0]?.kind).toBe('touchline')
    const w = pickBallWinner(s, 0)
    const h = pickHelper(s, 0, w)
    expect(w).not.toBeNull()
    expect(h).not.toBeNull()
    expect(h).not.toBe(w)
    void c
  })

  it('a low block only reacts near its own goal; the jump ends with time or when the ball is won', () => {
    const low = scene('low')
    carrier(low.s, low.dir, 9, 0, 26, true)
    updatePressTriggers(low.s)
    expect(low.s.pressTrigger[0]).toBeNull()
    const { s, dir } = scene('mid')
    carrier(s, dir, 9, 0, 14, true)
    updatePressTriggers(s)
    expect(pressTriggerActive(s, 0)).toBe(true)
    s.time += PRESS_TRIGGER.duration + 0.1
    s.players[9]!.aiHoldTimer = 5 // no new cue
    updatePressTriggers(s)
    expect(pressTriggerActive(s, 0)).toBe(false)
    carrier(s, dir, 9, 0, 14, true)
    updatePressTriggers(s)
    s.possessionTeam = 0
    updatePressTriggers(s)
    expect(s.pressTrigger[0]).toBeNull()
  })
})
