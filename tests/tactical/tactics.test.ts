import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { MatchSimulation } from '../../src/simulation/MatchSimulation'
import { diamondAnchor } from '../../src/ai/positioning/Formation'
import { DEFAULT_TACTICS, type TeamTactics } from '../../src/simulation/Tactics'
import { TICK_RATE } from '../../src/simulation/SimulationConfig'

const sim = (tactics?: [Partial<TeamTactics>?, Partial<TeamTactics>?], seed = 1) =>
  new MatchSimulation({
    seed,
    home: TEAM_LIBRARY[0]!,
    away: TEAM_LIBRARY[1]!,
    humanTeam: null,
    ...(tactics ? { tactics } : {}),
  })

describe('team tactics in the match state', () => {
  it('default tactics, the setup overrides them, a team plays its own style, a command changes them', () => {
    expect(sim().state.teams[0].tactics).toEqual(DEFAULT_TACTICS)
    expect(sim([{ formation: '4-0' }]).state.teams[0].tactics).toEqual({ formation: '4-0', pressing: 'mid' })
    const tam = TEAM_LIBRARY.find((t) => t.id === 'TAM')!
    const m = new MatchSimulation({ seed: 1, home: TEAM_LIBRARY[0]!, away: tam, humanTeam: null })
    expect(m.state.teams[1].tactics.formation).toBe('4-0')
    m.step([{ type: 'SetTactics', team: 1, tactics: { pressing: 'low' } }])
    expect(m.state.teams[1].tactics).toEqual({ formation: '4-0', pressing: 'low' })
  })
})

/** Average gap between the most advanced and the second most advanced outfield player in possession. */
function topGap(formation: TeamTactics['formation']): number {
  let gap = 0
  let n = 0
  for (const seed of [1, 2]) {
    const m = sim([{ formation }], seed)
    const s = m.state
    for (let i = 0; i < TICK_RATE * 90; i++) {
      m.step()
      if (s.phase !== 'play' || s.possessionTeam !== 0 || i % 30) continue
      const dir = s.teams[0].attackDir
      const ys = s.players
        .filter((p) => p.team === 0 && p.role !== 'GK')
        .map((p) => p.pos.y * dir)
        .sort((a, b) => b - a)
      gap += ys[0]! - ys[1]!
      n++
    }
  }
  return gap / n
}

describe('formations', () => {
  it('3-1 attacks with a pivot clearly ahead; 4-0 attacks flat', () => {
    const g31 = topGap('3-1')
    const g40 = topGap('4-0')
    // (The 3-1 gap includes the moments a teammate runs on past the pivot when he has the ball.)
    expect(g31).toBeGreaterThan(3.8)
    expect(g40).toBeLessThan(2.8)
    expect(g31).toBeGreaterThan(g40 * 2)
  }, 60000)

  it('2-2 defends in a box: two in front, two behind, one of each pair on either side', () => {
    const ball = { x: 0, y: 6 }
    const t: TeamTactics = { formation: '2-2', pressing: 'mid' }
    const a = (role: 'FIXO' | 'ALA_L' | 'ALA_R' | 'PIVOT') => diamondAnchor(role, 1, ball, t)
    // Front pair (ALA_L, pivot) ahead of the back pair (fixo, ALA_R).
    expect(Math.min(a('ALA_L').y, a('PIVOT').y)).toBeGreaterThan(Math.max(a('FIXO').y, a('ALA_R').y) + 2)
    expect(Math.sign(a('ALA_L').x)).toBe(-Math.sign(a('PIVOT').x))
    expect(Math.sign(a('FIXO').x)).toBe(-Math.sign(a('ALA_R').x))
  })
})

describe('pressing height', () => {
  /** Average distance of the defending team's outfield players from their own goal in their build-up. */
  function defDepth(pressing: TeamTactics['pressing']): number {
    let depth = 0
    let n = 0
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const m = sim([{ pressing }], seed)
      const s = m.state
      for (let i = 0; i < TICK_RATE * 90; i++) {
        m.step()
        if (s.phase !== 'play' || s.possessionTeam !== 1 || i % 30) continue
        const dir = s.teams[0].attackDir
        // Their build-up (ball in their half): how high the team defends it. (Overall averages mix in
        // the times a high press has been played through.)
        if (s.ball.pos.y * dir < 0) continue
        for (const p of s.players)
          if (p.team === 0 && p.role !== 'GK') {
            depth += p.pos.y * dir + 20
            n++
          }
      }
    }
    return depth / n
  }

  it('a low block defends deeper than the mid-block, a high press higher', () => {
    const low = defDepth('low')
    const mid = defDepth('mid')
    const high = defDepth('high')
    expect(low).toBeLessThan(mid - 1.5)
    expect(high).toBeGreaterThan(mid + 1)
  }, 180000)

  it('the top of the block follows the pressing height', () => {
    const ball = { x: 0, y: 18 } // by the opponents' goal
    const top = (pressing: TeamTactics['pressing']) =>
      diamondAnchor('PIVOT', 1, ball, { formation: '3-1', pressing }).y
    expect(top('low')).toBeLessThan(top('mid') - 5)
    expect(top('high')).toBeGreaterThan(top('mid') + 2)
  })
})
