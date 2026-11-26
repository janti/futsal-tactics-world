import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { MatchSimulation, createInitialState } from '../../src/simulation/MatchSimulation'
import { carrierOptions, markingPosition, squareOptionSpot } from '../../src/ai/BasicAI'
import { SeededRandom } from '../../src/core/random/SeededRandom'
import { updatePlayerMovement } from '../../src/physics/PlayerPhysics'
import { len } from '../../src/core/math/vec2'

function state() {
  const s = createInitialState({ seed: 5, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: null })
  s.phase = 'play'
  s.restart = null
  return s
}

describe('human control', () => {
  it('a human player changing direction at speed keeps more of his pace than an AI player', () => {
    const speedAfterTurn = (human: boolean) => {
      const s = state()
      const p = s.players[2]!
      p.pos = { x: 0, y: 0 }
      p.facing = 0
      p.vel = { x: 5, y: 0 }
      p.sprint = true
      p.moveIntent = { x: 0, y: 1 } // a 90 degree change of direction
      for (let i = 0; i < 12; i++) updatePlayerMovement(p, false, 1 / 60, human)
      return len(p.vel)
    }
    expect(speedAfterTurn(true)).toBeGreaterThan(speedAfterTurn(false))
  })
})

describe('defending alas keep their side', () => {
  it('an ala does not follow a man across to the far side of the court', () => {
    const s = state()
    const dir = s.teams[0].attackDir
    // Team 1 has the ball on team 0's right; team 0's ALA_L (2) has his side at x = +dir.
    for (const p of s.players) p.pos = { x: 0, y: p.team === 0 ? -dir * 10 : -dir * 4 }
    const owner = s.players[9]!
    owner.pos = { x: 0, y: -dir * 2 }
    s.ball.ownerId = 9
    s.ball.pos = { ...owner.pos }
    s.possessionTeam = 1
    // All team 1 outfield players crowd the other side (x = -dir * 6).
    s.players[6]!.pos = { x: -dir * 6, y: -dir * 9 }
    s.players[7]!.pos = { x: -dir * 7, y: -dir * 6 }
    s.players[8]!.pos = { x: -dir * 5, y: -dir * 12 }
    const ala = s.players[2]!
    ala.pos = { x: dir * 5, y: -dir * 10 }
    const spot = markingPosition(s, ala, [3])
    // At most two metres over the middle towards the far side.
    expect(-dir * spot.x).toBeLessThanOrEqual(2.01)
  })
})

describe('build-up', () => {
  it('the deepest player turning to one side gets an ala dropping level with him on that side', () => {
    const s = state()
    const dir = s.teams[0].attackDir
    const fixo = s.players[1]!
    fixo.pos = { x: 0, y: -dir * 12 }
    fixo.facing = 0 // facing +x
    s.ball.ownerId = 1
    s.ball.pos = { ...fixo.pos }
    s.possessionTeam = 0
    s.players[2]!.pos = { x: dir * 6, y: -dir * 4 }
    s.players[3]!.pos = { x: -dir * 6, y: -dir * 4 }
    s.players[4]!.pos = { x: 0, y: dir * 4 }
    const right = s.players.find((q) => q.team === 0 && q.role !== 'GK' && q.pos.x > 3 && q.id !== 4)!
    const spot = squareOptionSpot(s, right)
    expect(spot).not.toBeNull()
    expect(spot!.x).toBeGreaterThan(5)
    expect(Math.abs(spot!.y - fixo.pos.y)).toBeLessThan(1)
    // Nobody drops while he faces straight up the court.
    fixo.facing = dir === 1 ? Math.PI / 2 : -Math.PI / 2
    expect(squareOptionSpot(s, right)).toBeNull()
  })

  it('the vertical ball into the pivot is played even with a marker tight behind him', () => {
    const s = state()
    const dir = s.teams[0].attackDir
    for (const p of s.players) p.pos = { x: p.team === 0 ? -9 : 9, y: p.team === 0 ? -16 * dir : 16 * dir }
    const carrier = s.players[1]!
    carrier.pos = { x: 0, y: -dir * 6 }
    carrier.aiHoldTimer = 1
    const pivot = s.players[4]!
    pivot.pos = { x: 0.5, y: dir * 6 }
    s.players[6]!.pos = { x: 0.5, y: dir * 7 } // tight behind the pivot (goal-side)
    s.players[5]!.pos = { x: 0, y: dir * 19.3 }
    s.ball.ownerId = 1
    s.ball.pos = { ...carrier.pos }
    s.possessionTeam = 0
    const options = carrierOptions(s, carrier, new SeededRandom(1), {
      open: true,
      pressure: 0,
      toGoal: 26,
      goal: { x: 0, y: dir * 20 },
      nearest: null,
    })
    expect(options.some((o) => o.kind === 'pivot')).toBe(true)
  })

  it('AI vs AI: the pivot is found and laid off to', () => {
    let pivot = 0
    let layoff = 0
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const sim = new MatchSimulation({
        seed,
        home: TEAM_LIBRARY[0]!,
        away: TEAM_LIBRARY[1]!,
        humanTeam: null,
      })
      for (let i = 0; i < 60 * 150; i++) {
        sim.step()
        for (const e of sim.drainEvents())
          if (e.type === 'PassStarted') {
            const k = sim.player(e.playerId).aiDecision
            if (k === 'pivot') pivot++
            if (k === 'layoff') layoff++
          }
      }
    }
    expect(pivot).toBeGreaterThan(8)
    expect(layoff).toBeGreaterThan(0)
  }, 60000)
})
