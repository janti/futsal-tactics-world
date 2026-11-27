import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { MatchSimulation } from '../../src/simulation/MatchSimulation'
import {
  LIBRARY_SCENARIOS,
  demoPriorities,
  SCENARIOS,
  SCENARIO_ORDER,
  applyScenario,
  scenarioOutcome,
  type ScenarioId,
  type ScenarioOutcome,
} from '../../src/lab/scenarios'
import { DT } from '../../src/simulation/SimulationConfig'
import type { TeamId } from '../../src/simulation/MatchState'

function labSim(seed: number, humanTeam: TeamId | null = null) {
  return new MatchSimulation({
    seed,
    home: TEAM_LIBRARY[0]!,
    away: TEAM_LIBRARY[1]!,
    humanTeam,
    rules: { halfLength: 99 * 60 },
  })
}

/** One attempt of a scenario, computer against computer; the outcome and whether its rotation started. */
function attempt(id: ScenarioId, seed: number, attackTeam: TeamId, demo = false, drill = false) {
  const sc = SCENARIOS[id]
  const sim = labSim(seed)
  const def: TeamId = attackTeam === 0 ? 1 : 0
  sim.state.teams[attackTeam].tactics.formation = sc.attackFormation
  if (demo && sc.rotation) sim.state.teams[attackTeam].tactics.priorities = demoPriorities(sc.rotation)
  sim.state.drill = drill
  sim.state.teams[def].tactics.pressing = sc.defendPressing
  sim.step()
  applyScenario(sim.state, sc, attackTeam)
  sim.drainEvents()
  const before = sc.rotation ? sim.state.rotationStats[attackTeam][sc.rotation].started : 0
  let outcome: ScenarioOutcome | null = null
  let t = 0
  while (!outcome) {
    sim.step()
    t += DT
    outcome = scenarioOutcome(sim.drainEvents(), attackTeam, t, sc)
  }
  const rotated = sc.rotation !== null && sim.state.rotationStats[attackTeam][sc.rotation].started > before
  return { outcome, rotated, seconds: t }
}

describe('Tactical Lab scenarios', () => {
  it('place the situation for either team: mirrored positions, the carrier on the ball, possession', () => {
    for (const id of SCENARIO_ORDER) {
      const sc = SCENARIOS[id]
      const pos: Record<number, { x: number; d: number }>[] = []
      for (const team of [0, 1] as const) {
        const sim = labSim(1)
        applyScenario(sim.state, sc, team)
        const s = sim.state
        const dir = s.teams[team].attackDir
        const carrier = s.players.find((p) => p.team === team && p.role === sc.carrier)!
        expect(s.phase).toBe('play')
        expect(s.restart).toBeNull()
        expect(s.ball.ownerId).toBe(carrier.id)
        expect(s.possessionTeam).toBe(team)
        // In the attackers' frame the layout is the same whichever team attacks.
        const frame: Record<number, { x: number; d: number }> = {}
        for (const p of s.players) {
          const k = (p.team === team ? 0 : 10) + ['GK', 'FIXO', 'ALA_L', 'ALA_R', 'PIVOT'].indexOf(p.role)
          frame[k] = { x: p.pos.x * dir, d: 20 - p.pos.y * dir }
        }
        pos.push(frame)
      }
      for (const k of Object.keys(pos[0]!)) {
        expect(pos[1]![+k]!.x).toBeCloseTo(pos[0]![+k]!.x, 6)
        expect(pos[1]![+k]!.d).toBeCloseTo(pos[0]![+k]!.d, 6)
      }
    }
  })

  it('the human gets the carrier when attacking, the defender nearest the ball when defending', () => {
    const sc = SCENARIOS.overlap
    const sim = labSim(2, 0)
    applyScenario(sim.state, sc, 0)
    expect(sim.state.controlledId).toBe(sim.state.ball.ownerId)
    applyScenario(sim.state, sc, 1)
    const c = sim.state.players[sim.state.controlledId!]!
    expect(c.team).toBe(0)
    expect(c.role).not.toBe('GK')
    const ball = sim.state.ball.pos
    for (const p of sim.state.players)
      if (p.team === 0 && p.role !== 'GK')
        expect(Math.hypot(c.pos.x - ball.x, c.pos.y - ball.y)).toBeLessThanOrEqual(
          Math.hypot(p.pos.x - ball.x, p.pos.y - ball.y) + 1e-9,
        )
  })

  it('a second attempt starts clean (no carry-over from the first)', () => {
    const sc = SCENARIOS.backPost
    const sim = labSim(3)
    applyScenario(sim.state, sc, 0)
    for (let i = 0; i < 60 * 4; i++) sim.step()
    applyScenario(sim.state, sc, 0)
    const s = sim.state
    expect(s.rotation).toEqual([null, null])
    expect(s.pressTrigger).toEqual([null, null])
    expect(s.ball.mode).toBe('controlled')
    expect(s.ball.isShot).toBe(false)
    for (const p of s.players) {
      expect(p.aiRunTimer).toBe(0)
      expect(p.vel.x).toBe(0)
    }
  })

  it('every scenario ends in an outcome within its time limit', () => {
    for (const id of SCENARIO_ORDER) {
      const r = attempt(id, 7, 0)
      expect(r.seconds).toBeLessThanOrEqual(SCENARIOS[id].timeLimit + DT)
    }
  })

  it('the rotation scenarios show their rotation in most attempts; the 2 v 0 is mostly a goal', () => {
    const n = 12
    for (const id of SCENARIO_ORDER) {
      const sc = SCENARIOS[id]
      if (!sc.rotation) continue
      // The original scenarios with the normal (context) selection; the library's own ones in
      // demonstration mode (in normal selection the AI may prefer another move there).
      const demo = LIBRARY_SCENARIOS.includes(id)
      let rotated = 0
      for (let k = 0; k < n; k++) if (attempt(id, 100 + k, (k % 2) as TeamId, demo).rotated) rotated++
      expect(rotated, id).toBeGreaterThanOrEqual(n * 0.6)
    }
    let goals = 0
    for (let k = 0; k < n; k++)
      if (attempt('twoOnKeeper', 200 + k, (k % 2) as TeamId).outcome === 'goal') goals++
    expect(goals).toBeGreaterThanOrEqual(n * 0.7)
    // (25 scenarios x 12 attempts: about 8 s alone, more with the whole suite in parallel.)
  }, 60000)

  it('drill defence + demonstration: the moves are played to a goal at least nine times in ten each', () => {
    // The Lab's default (drill defence, demonstration): the computer defenders move and mark but do
    // not win the ball, the keeper is a practice keeper. Every rotation scenario, 10 attempts each.
    let goals = 0
    let total = 0
    for (const id of SCENARIO_ORDER) {
      if (!SCENARIOS[id].rotation) continue
      let g = 0
      for (let k = 0; k < 10; k++)
        if (attempt(id, 300 + k, (k % 2) as TeamId, true, true).outcome === 'goal') g++
      expect(g, id).toBeGreaterThanOrEqual(9)
      goals += g
      total += 10
    }
    expect(goals / total).toBeGreaterThanOrEqual(0.95)
  }, 60000)

  it('outcome detection: goal, save, out, ball lost, time up', () => {
    const sc = SCENARIOS.breakaway
    const ev = (e: object) => [e as never]
    expect(scenarioOutcome(ev({ type: 'GoalScored', team: 0 }), 0, 1, sc)).toBe('goal')
    expect(scenarioOutcome(ev({ type: 'GoalScored', team: 1 }), 0, 1, sc)).toBe('conceded')
    expect(scenarioOutcome(ev({ type: 'Save' }), 0, 1, sc)).toBe('saved')
    expect(scenarioOutcome(ev({ type: 'BallOut' }), 0, 1, sc)).toBe('out')
    expect(scenarioOutcome(ev({ type: 'PossessionChanged', team: 1 }), 0, 1, sc)).toBe('lost')
    expect(scenarioOutcome(ev({ type: 'PossessionChanged', team: 0 }), 0, 1, sc)).toBeNull()
    expect(scenarioOutcome([], 0, sc.timeLimit, sc)).toBe('timeout')
  })
})
