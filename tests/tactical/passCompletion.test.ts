import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { MatchSimulation } from '../../src/simulation/MatchSimulation'
import type { Formation } from '../../src/simulation/Tactics'
import { laneOpenness } from '../../src/physics/PassingPhysics'
import { rotationPassTarget } from '../../src/ai/BasicAI'
import { SCENARIOS, applyScenario, type Scenario } from '../../src/lab/scenarios'

/**
 * Computer vs computer: the share of passes (open play, outfield players, clearances left out) that
 * reach a teammate, and how many go into the pivot's feet.
 */
function passStats(formation: Formation, seeds: number[]) {
  let made = 0
  let completed = 0
  let pivot = 0
  let pivotOk = 0
  for (const seed of seeds) {
    const sim = new MatchSimulation({
      seed,
      home: TEAM_LIBRARY[0]!,
      away: TEAM_LIBRARY[1]!,
      humanTeam: null,
      tactics: [{ formation }, { formation }],
    })
    const s = sim.state
    let pending: { team: number; pivot: boolean } | null = null
    const settle = (ok: boolean) => {
      made++
      if (ok) completed++
      if (pending!.pivot) {
        pivot++
        if (ok) pivotOk++
      }
      pending = null
    }
    for (let i = 0; i < 60 * 60 * 8 && s.phase !== 'fulltime'; i++) {
      sim.step()
      for (const e of sim.drainEvents()) {
        if (e.type === 'PassStarted' && e.receiverId !== null) {
          const p = s.players[e.playerId]!
          const skip = p.role === 'GK' || s.phase !== 'play' || ['clear', 'kickOut'].includes(p.aiDecision)
          pending = skip ? null : { team: p.team, pivot: p.aiDecision === 'pivot' }
        }
        if (pending && e.type === 'BallOut') settle(false)
      }
      if (pending && s.ball.ownerId !== null) settle(s.players[s.ball.ownerId]!.team === pending.team)
    }
  }
  return { made, rate: completed / made, pivot, pivotRate: pivotOk / Math.max(1, pivot) }
}

describe('passing quality', () => {
  it('the computer keeps the ball: easy passes to a side, the ball into the pivot only when it is on', () => {
    const r31 = passStats('3-1', [1, 2, 3])
    const r40 = passStats('4-0', [1, 2, 3])
    console.log('pass completion', r31, r40)
    expect(r31.made).toBeGreaterThan(400)
    expect(r31.rate).toBeGreaterThan(0.86)
    expect(r40.rate).toBeGreaterThan(0.89)
    // The rotation goes on until the pivot can be found to feet; then the ball into him mostly arrives.
    expect(r31.pivot).toBeGreaterThan(20)
    expect(r31.pivotRate).toBeGreaterThan(0.75)
  }, 120000)

  it('in the build-up the side players get free: away from their markers, the lane to them open', () => {
    // Our central player has the ball 14-34 m from goal: how free are the wide players beside him,
    // and how often is the easy pass to a side on?
    const sample = (formation: Formation) => {
      let n = 0
      let free = 0
      let lane = 0
      let samples = 0
      let sideOn = 0
      for (const seed of [1, 2]) {
        const sim = new MatchSimulation({
          seed,
          home: TEAM_LIBRARY[0]!,
          away: TEAM_LIBRARY[1]!,
          humanTeam: null,
          tactics: [{ formation }, { formation }],
        })
        const s = sim.state
        for (let i = 0; i < 60 * 60 * 8 && s.phase !== 'fulltime'; i++) {
          sim.step()
          if (i % 15 || s.phase !== 'play' || s.ball.ownerId === null) continue
          const c = s.players[s.ball.ownerId]!
          const dir = s.teams[c.team].attackDir
          const depth = (dir * 20 - c.pos.y) * dir
          if (c.role === 'GK' || depth < 14 || depth > 34 || Math.abs(c.pos.x) > 4) continue
          samples++
          if (rotationPassTarget(s, c)) sideOn++
          for (const t of s.players) {
            if (t.team !== c.team || t.id === c.id || t.role === 'GK' || Math.abs(t.pos.x) < 3.5) continue
            if (Math.abs(t.pos.y - c.pos.y) > 9 || t.aiState !== 'support') continue
            let f = Infinity
            for (const o of s.players)
              if (o.team !== c.team && o.role !== 'GK')
                f = Math.min(f, Math.hypot(o.pos.x - t.pos.x, o.pos.y - t.pos.y))
            n++
            free += Math.min(f, 8)
            lane += Math.min(laneOpenness(s, c.team, c.pos, t.pos), 3)
          }
        }
      }
      return { free: free / n, lane: lane / n, sideOn: sideOn / samples }
    }
    const a = sample('3-1')
    const b = sample('4-0')
    console.log('side support', a, b)
    expect(a.free).toBeGreaterThan(3.6)
    expect(b.free).toBeGreaterThan(3.9)
    expect(b.sideOn).toBeGreaterThan(0.45)
  }, 120000)

  it('no forced pass: the middle man of the pohjakasi waits with the ball while every lane is shut', () => {
    // Both wings and the pivot marked tight (an opponent between them and the ball, held there), nobody
    // pressing the middle man: he keeps it and walks it up instead of playing a ball that would be cut out.
    const closed: Scenario = {
      ...SCENARIOS.baseEight,
      defenders: {
        PIVOT: { x: 0, d: 13.2 },
        ALA_L: { x: 6.2, d: 24 },
        ALA_R: { x: -6.2, d: 24 },
        FIXO: { x: 0, d: 19 },
      },
    }
    for (const seed of [1, 2, 3]) {
      const sim = new MatchSimulation({
        seed,
        home: TEAM_LIBRARY[0]!,
        away: TEAM_LIBRARY[1]!,
        humanTeam: null,
        rules: { halfLength: 99 * 60 },
      })
      sim.step()
      applyScenario(sim.state, closed, 0)
      sim.drainEvents()
      const carrier = sim.state.ball.ownerId!
      const start = { ...sim.state.players[carrier]!.pos }
      // Tight marking held every tick: each marker a metre from his man, between him and the ball.
      const st = sim.state
      const mark = (defRole: string, attRole: string) => ({
        d: st.players.find((q) => q.team === 1 && q.role === defRole)!,
        a: st.players.find((q) => q.team === 0 && q.role === attRole)!,
      })
      const pairs = [mark('ALA_L', 'ALA_R'), mark('ALA_R', 'ALA_L'), mark('PIVOT', 'PIVOT')]
      let passed = false
      for (let i = 0; i < 60; i++) {
        const c = st.players[carrier]!.pos
        for (const { d, a } of pairs) {
          const l = Math.hypot(c.x - a.pos.x, c.y - a.pos.y) || 1
          d.pos = { x: a.pos.x + ((c.x - a.pos.x) / l) * 1, y: a.pos.y + ((c.y - a.pos.y) / l) * 1 }
          d.vel = { ...a.vel }
        }
        sim.step()
        for (const e of sim.drainEvents())
          if (e.type === 'PassStarted' && e.playerId === carrier) {
            passed = true
          }
      }
      const p = sim.state.players[carrier]!
      expect(passed).toBe(false)
      expect(sim.state.ball.ownerId).toBe(carrier)
      // Walking pace, not driving into the block.
      expect(Math.hypot(p.pos.x - start.x, p.pos.y - start.y)).toBeLessThan(2.5)
    }
  })
})
