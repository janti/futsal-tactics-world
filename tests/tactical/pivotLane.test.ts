import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { createInitialState } from '../../src/simulation/MatchSimulation'
import { markingPosition, opponentPivot } from '../../src/ai/team/defending'
import { closestOnSegment, type Vec2 } from '../../src/core/math/vec2'
import type { MatchState } from '../../src/simulation/MatchState'

const d = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * Team 1 has the ball with its fixo (6) deep; its pivot (9) is up front in the middle, its alas (7, 8)
 * wide. Team 0 defends (attacking +dir, so its goal is at -dir * 20).
 */
function scene(formation: '3-1' | '2-2' = '3-1'): { s: MatchState; dir: number } {
  const s = createInitialState({
    seed: 4,
    home: TEAM_LIBRARY[0]!,
    away: TEAM_LIBRARY[1]!,
    humanTeam: null,
    tactics: [{ formation }],
  })
  s.phase = 'play'
  const dir = s.teams[0].attackDir
  const at = (id: number, x: number, y: number) => (s.players[id]!.pos = { x, y: dir * y })
  at(6, 0.5, 4) // their fixo with the ball, in their half
  at(9, 0, -10) // their pivot, central, near our goal
  at(7, -7, -2)
  at(8, 7, -2)
  at(1, 0, -12)
  at(2, -5, -4)
  at(3, 5, -4)
  at(4, 0, 1)
  s.ball.ownerId = 6
  s.ball.mode = 'controlled'
  s.ball.pos = { x: 0.5, y: dir * 3.6 }
  s.possessionTeam = 1
  return { s, dir }
}

describe('diamond defence shuts the pass into the pivot', () => {
  it('their pivot is their furthest man up, clearly ahead of the ball', () => {
    const { s } = scene()
    expect(opponentPivot(s, 0, s.players[6]!)?.id).toBe(9)
  })

  it("the pivot's marker stays tight on him; the alas lean off their men into the lane to him", () => {
    const { s } = scene('3-1')
    const box = scene('2-2').s
    const lane = (st: MatchState, pos: Vec2) => {
      const { point } = closestOnSegment(st.players[6]!.pos, st.players[9]!.pos, pos)
      return d(point, pos)
    }
    // Who marks whom is decided by the assignment; find the pivot's marker and an ala marking a wide man.
    const marks = [1, 2, 3].map((id) => ({
      id,
      pos: markingPosition(s, s.players[id]!, [4]),
      man: s.players[id]!.aiMarkId,
    }))
    const pivotMarker = marks.find((m) => m.man === 9)!
    expect(pivotMarker).toBeDefined()
    expect(d(pivotMarker.pos, s.players[9]!.pos)).toBeLessThan(1.7)
    const ala = marks.find((m) => m.man === 7 || m.man === 8)!
    const alaBox = markingPosition(box, box.players[ala.id]!, [4])
    // Closer to the lane than the same defender in the 2-2 box (which marks as usual).
    expect(lane(s, ala.pos)).toBeLessThan(lane(box, alaBox) - 0.3)
    // ...but still within reach of his man.
    expect(d(ala.pos, s.players[ala.man!]!.pos)).toBeLessThanOrEqual(3.6)
  })
})
