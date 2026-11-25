import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { presentationUpSign } from '../../src/camera/CameraController'
import type { MatchEvent } from '../../src/simulation/Events'
import { MatchSimulation } from '../../src/simulation/MatchSimulation'
import { TICK_RATE } from '../../src/simulation/SimulationConfig'

function sim(halfLength: number, effectiveClock = true, humanTeam: 0 | null = null, seed = 5) {
  return new MatchSimulation({
    seed,
    home: TEAM_LIBRARY[0]!,
    away: TEAM_LIBRARY[1]!,
    humanTeam,
    rules: { halfLength, effectiveClock, halftimeBreak: 1 },
  })
}

function runToEnd(m: MatchSimulation, maxSeconds: number) {
  const events: MatchEvent[] = []
  for (let i = 0; i < maxSeconds * TICK_RATE && m.state.phase !== 'fulltime'; i++) {
    m.step()
    events.push(...m.drainEvents())
  }
  return events
}

describe('match clock and halves', () => {
  it('plays two halves: half-time, ends switch, the other team kicks off, then full time', () => {
    const m = sim(30)
    const dirsBefore = m.state.teams.map((t) => t.attackDir)
    const events: MatchEvent[] = []
    let secondHalfKickoffTeam: number | null = null
    for (let i = 0; i < 200 * TICK_RATE && m.state.phase !== 'fulltime'; i++) {
      m.step()
      const ev = m.drainEvents()
      events.push(...ev)
      if (ev.some((e) => e.type === 'SecondHalfStarted')) secondHalfKickoffTeam = m.state.restart!.team
    }
    const types = events.map((e) => e.type)
    expect(types).toContain('HalfTime')
    expect(types).toContain('SecondHalfStarted')
    expect(types).toContain('MatchFinished')
    expect(types.indexOf('HalfTime')).toBeLessThan(types.indexOf('SecondHalfStarted'))
    expect(m.state.phase).toBe('fulltime')
    expect(m.state.half).toBe(2)
    expect(m.state.clock).toBe(0)
    // Ends switched for the second half.
    expect(m.state.teams.map((t) => t.attackDir)).toEqual(dirsBefore.map((d) => -d))
    // The team that did not kick off the first half kicks off the second.
    expect(secondHalfKickoffTeam).toBe(m.state.firstKickoffTeam === 0 ? 1 : 0)
    // Effective time: total open-play time equals both halves.
    expect(m.state.playingTime).toBeCloseTo(60, 0)
  })

  it('effective clock stops during restarts; a running clock does not', () => {
    for (const effective of [true, false]) {
      const m = sim(60, effective)
      // The opening kick-off is a stoppage until the AI kicks off.
      for (let i = 0; i < 30; i++) m.step()
      expect(m.state.phase).toBe('restart')
      if (effective) expect(m.state.clock).toBe(60)
      else expect(m.state.clock).toBeLessThan(60)
    }
  })

  it('after full time the match is frozen (score, ball and clock do not change)', () => {
    const m = sim(20)
    runToEnd(m, 120)
    expect(m.state.phase).toBe('fulltime')
    const score = [...m.state.score]
    const ball = { ...m.state.ball.pos }
    for (let i = 0; i < 300; i++) m.step([{ type: 'Shoot', dir: { x: 0, y: 1 }, power: 1 }])
    expect(m.drainEvents().length).toBe(0)
    expect(m.state.score).toEqual(score)
    expect(m.state.ball.pos).toEqual(ball)
  })

  it('statistics are consistent with the match', () => {
    const m = sim(60, true, null, 7)
    runToEnd(m, 400)
    for (const t of [0, 1] as const) {
      const st = m.state.stats[t]
      expect(st.goals).toBe(m.state.score[t])
      expect(st.shotsOnTarget).toBeLessThanOrEqual(st.shots)
      expect(st.passesCompleted).toBeLessThanOrEqual(st.passes)
      expect(st.passes).toBeGreaterThan(10)
    }
    const poss = m.state.stats[0].possessionTicks + m.state.stats[1].possessionTicks
    expect(poss).toBeGreaterThan(0)
    expect(poss / TICK_RATE).toBeLessThanOrEqual(m.state.playingTime + 0.1)
    const saves = m.state.stats[0].saves + m.state.stats[1].saves
    const onTarget = m.state.stats[0].shotsOnTarget + m.state.stats[1].shotsOnTarget
    expect(onTarget).toBeGreaterThanOrEqual(saves)
  })

  it('a human match also reaches full time when the human kicks off', () => {
    const m = sim(15, true, 0)
    let finished = false
    for (let i = 0; i < 200 * TICK_RATE && !finished; i++) {
      const r = m.state.restart
      const cmds =
        r?.ready && r.team === 0 ? [{ type: 'Pass' as const, dir: { x: 0, y: -1 }, through: false }] : []
      m.step(cmds)
      finished = m.drainEvents().some((e) => e.type === 'MatchFinished')
    }
    expect(finished).toBe(true)
  })
})

describe('presentation orientation at half-time', () => {
  it('keeps the human team attacking up when enabled, otherwise keeps the initial orientation', () => {
    expect(presentationUpSign(0, [1, -1], true, 1)).toBe(1)
    expect(presentationUpSign(0, [-1, 1], true, 1)).toBe(-1) // second half: view rotates
    expect(presentationUpSign(0, [-1, 1], false, 1)).toBe(1) // traditional: fixed view
    expect(presentationUpSign(null, [-1, 1], true, 1)).toBe(1)
  })
})
