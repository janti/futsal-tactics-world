import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { createInitialState } from '../../src/simulation/MatchSimulation'
import { defensiveRole } from '../../src/ai/team/roles'
import { markingAssignment, pickHelper } from '../../src/ai/team/defending'
import { updatePressTriggers } from '../../src/ai/team/pressing'
import type { MatchState } from '../../src/simulation/MatchState'

/** Team 1 has the ball; team 0 defends (its goal at -dir * 20). */
function scene(): { s: MatchState; dir: number } {
  const s = createInitialState({ seed: 6, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: null })
  s.phase = 'play'
  s.restart = null
  s.possessionTeam = 1
  return { s, dir: s.teams[0].attackDir }
}

describe('defensive shape', () => {
  it('after losing the ball, players fill the diamond from where they are (no running across)', () => {
    const { s, dir } = scene()
    // Team 0's nominal pivot (4) is caught out on the left wing, the nominal left ala (2) in the middle.
    const leftX = dir // ALA_L's side of the court is x = +dir
    s.players[4]!.pos = { x: leftX * 7, y: -dir * 2 }
    s.players[2]!.pos = { x: 0, y: -dir * 1 }
    s.players[3]!.pos = { x: -leftX * 6, y: -dir * 5 }
    s.players[1]!.pos = { x: 0, y: -dir * 11 }
    s.players[9]!.pos = { x: 0, y: dir * 6 }
    s.ball.ownerId = 9
    s.ball.mode = 'controlled'
    s.ball.pos = { x: 0, y: dir * 5.6 }
    expect(defensiveRole(s, s.players[2]!)).toBe('PIVOT')
    expect(defensiveRole(s, s.players[4]!)).toBe('ALA_L')
    expect(defensiveRole(s, s.players[1]!)).toBe('FIXO')
  })

  it('our pivot is not given a man out wide to mark: an ala or the fixo takes him', () => {
    const { s, dir } = scene()
    s.players[1]!.pos = { x: 0, y: -dir * 12 }
    s.players[2]!.pos = { x: dir * 5, y: -dir * 6 }
    s.players[3]!.pos = { x: -dir * 5, y: -dir * 6 }
    s.players[4]!.pos = { x: 0, y: -dir * 2 }
    s.players[6]!.pos = { x: 0, y: dir * 4 } // carrier
    s.ball.ownerId = 6
    s.ball.mode = 'controlled'
    s.ball.pos = { x: 0, y: dir * 3.6 }
    s.players[7]!.pos = { x: 8.5, y: -dir * 3 } // wide men
    s.players[8]!.pos = { x: -8.5, y: -dir * 3 }
    s.players[9]!.pos = { x: 0.5, y: -dir * 10 }
    const marks = markingAssignment(s, 0, [])
    const pivotId = [1, 2, 3, 4].find((id) => defensiveRole(s, s.players[id]!) === 'PIVOT')!
    const hisMan = marks.get(pivotId)
    if (hisMan !== undefined) expect(Math.abs(s.players[hisMan]!.pos.x)).toBeLessThan(4.5)
  })

  it('on a pressing trigger the trap is set by an ala, never by our pivot', () => {
    const { s, dir } = scene()
    // Their carrier just received facing his own goal, out on the right, 14 m from our goal.
    const c = s.players[8]!
    c.pos = { x: -dir * 6, y: -dir * 6 }
    c.facing = dir > 0 ? Math.PI / 2 : -Math.PI / 2
    c.aiHoldTimer = 0.2
    s.ball.ownerId = 8
    s.ball.mode = 'controlled'
    s.ball.pos = { ...c.pos }
    s.players[1]!.pos = { x: 0, y: -dir * 12 }
    s.players[2]!.pos = { x: dir * 4, y: -dir * 9 }
    s.players[3]!.pos = { x: -dir * 4, y: -dir * 9 }
    s.players[4]!.pos = { x: -dir * 3, y: -dir * 5 } // our pivot is right there
    updatePressTriggers(s)
    expect(s.pressTrigger[0]).not.toBeNull()
    const winner = 3
    const h = pickHelper(s, 0, winner)
    if (h !== null) expect(defensiveRole(s, s.players[h]!)).not.toBe('PIVOT')
  })
})

describe('runs in behind', () => {
  it('when their pivot has the ball and a teammate runs in behind, his marker goes with him', async () => {
    const { MatchSimulation } = await import('../../src/simulation/MatchSimulation')
    const { TICK_RATE } = await import('../../src/simulation/SimulationConfig')
    let tracked = 0
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const sim = new MatchSimulation({
        seed,
        home: TEAM_LIBRARY[0]!,
        away: TEAM_LIBRARY[1]!,
        humanTeam: null,
      })
      const s = sim.state
      for (let i = 0; i < 600 && !s.restart?.ready; i++) sim.step()
      s.phase = 'play'
      s.restart = null
      const dir = s.teams[0].attackDir // team 1 attacks -dir, towards team 0's goal at -dir * 20
      const at = (id: number, x: number, y: number) => {
        s.players[id]!.pos = { x, y: -dir * y }
        s.players[id]!.vel = { x: 0, y: 0 }
      }
      at(9, 0, 9) // their pivot with the ball, 11 m from our goal
      at(8, 5, 3) // the runner, starting level with the play out on the right
      at(7, -6, 2)
      at(6, 0, -6)
      at(1, 0, 13) // our fixo behind their pivot
      at(3, 5.5, 5) // our ala marking the runner
      at(2, -5.5, 4)
      at(4, 0, 2)
      s.ball.ownerId = 9
      s.ball.mode = 'controlled'
      s.ball.pos = { x: 0, y: -dir * 9.4 }
      s.possessionTeam = 1
      const runner = s.players[8]!
      const steps = Math.round(TICK_RATE * 1.3)
      for (let i = 1; i <= steps; i++) {
        // Their pivot holds it up; the runner sprints in behind down the right (scripted: 6.5 m/s).
        const c = s.players[9]!
        c.pos = { x: 0, y: -dir * 9 }
        c.vel = { x: 0, y: 0 }
        s.ball.ownerId = 9
        s.ball.pos = { x: 0, y: -dir * 9.4 }
        sim.step()
        runner.pos = { x: 5, y: -dir * (3 + (6.5 * i) / TICK_RATE) }
        runner.vel = { x: 0, y: -dir * 6.5 }
      }
      // The runner is deep now (about 8.5 m on, 8.5 m from goal): is somebody with him?
      let near = Infinity
      for (const q of s.players)
        if (q.team === 0 && q.role !== 'GK')
          near = Math.min(near, Math.hypot(q.pos.x - runner.pos.x, q.pos.y - runner.pos.y))
      if (seed < 3)
        console.log(
          'T',
          seed,
          'runner',
          runner.pos.x.toFixed(1),
          runner.pos.y.toFixed(1),
          JSON.stringify(
            s.players
              .filter((q) => q.team === 0 && q.role !== 'GK')
              .map((q) => [q.id, q.aiState, q.aiMarkId, q.pos.x.toFixed(1), q.pos.y.toFixed(1)]),
          ),
          'phase',
          s.phase,
          'owner',
          s.ball.ownerId,
        )
      if (near < 2.5) tracked++
    }
    expect(tracked).toBeGreaterThanOrEqual(4)
  }, 30000)
})
