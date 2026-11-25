import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { MatchSimulation } from '../../src/simulation/MatchSimulation'
import { restartInward } from '../../src/simulation/RestartGeometry'
import { COURT, POST_X, POST_Y, TICK_RATE } from '../../src/simulation/SimulationConfig'
import { resolveGoalCollisions, updatePlayerMovement } from '../../src/physics/PlayerPhysics'
import { createInitialState } from '../../src/simulation/MatchSimulation'

function aiSim(seed: number) {
  return new MatchSimulation({ seed, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: null })
}

describe('kick-in and corner takers stand behind the ball', () => {
  it('when ready, the taker is outside the court with the ball in front of him on the line', () => {
    let checked = 0
    for (const seed of [1, 2, 3, 5, 7]) {
      const sim = aiSim(seed)
      const s = sim.state
      for (let i = 0; i < TICK_RATE * 200 && checked < 12; i++) {
        sim.step()
        const r = s.restart
        if (!r?.ready || (r.type !== 'kickIn' && r.type !== 'corner') || r.readyTimer > 0) continue
        const taker = sim.player(r.takerId)
        const inward = restartInward(s, r)
        // Ball in front: from the taker towards the ball points into the court.
        const toBall = { x: s.ball.pos.x - taker.pos.x, y: s.ball.pos.y - taker.pos.y }
        const along = toBall.x * inward.x + toBall.y * inward.y
        expect(along).toBeGreaterThan(0.15)
        expect(Math.hypot(toBall.x, toBall.y)).toBeLessThan(0.85)
        if (r.type === 'kickIn') expect(Math.abs(taker.pos.x)).toBeGreaterThan(COURT.halfWidth)
        if (r.type === 'corner') {
          expect(Math.abs(taker.pos.x)).toBeGreaterThan(COURT.halfWidth - 0.2)
          expect(Math.abs(taker.pos.y)).toBeGreaterThan(COURT.halfLength - 0.2)
        }
        checked++
      }
    }
    expect(checked).toBeGreaterThan(3)
  })
})

describe('players cannot run through the goal frame or nets', () => {
  function runner(
    pos: { x: number; y: number },
    intent: { x: number; y: number },
    role: 'GK' | 'FIXO' = 'FIXO',
  ) {
    const s = createInitialState({ seed: 3, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: null })
    const p = s.players.find((q) => q.role === role)!
    p.pos = { ...pos }
    p.vel = { x: 0, y: 0 }
    p.moveIntent = intent
    p.sprint = true
    for (let i = 0; i < TICK_RATE * 2; i++) {
      updatePlayerMovement(p, false, 1 / TICK_RATE)
      resolveGoalCollisions([p])
    }
    return p
  }
  const back = POST_Y + COURT.goalDepth

  it('from behind the goal, a player running towards the court stops at the back net', () => {
    const p = runner({ x: 0.3, y: back + 0.8 }, { x: 0, y: -1 })
    expect(p.pos.y).toBeGreaterThan(back)
  })

  it('a keeper inside the goal cannot run out through the back net', () => {
    const p = runner({ x: 0, y: COURT.halfLength + 0.4 }, { x: 0, y: 1 }, 'GK')
    expect(p.pos.y).toBeLessThan(back)
  })

  it('running sideways behind the goal line, a player cannot cross the side net', () => {
    const p = runner({ x: POST_X + 0.8, y: COURT.halfLength + 0.5 }, { x: -1, y: 0 })
    expect(p.pos.x).toBeGreaterThan(POST_X)
  })

  it('the open goal mouth can still be entered from the court', () => {
    const p = runner({ x: 0, y: COURT.halfLength - 1.5 }, { x: 0, y: 1 })
    expect(p.pos.y).toBeGreaterThan(COURT.halfLength)
    expect(p.pos.y).toBeLessThan(back)
  })
})

/** Human team 0. Force a restart for team 0 by sending the ball out last touched by team 1. */
function humanRestart(kind: 'kickIn' | 'corner') {
  const sim = new MatchSimulation({ seed: 12, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: 0 })
  const s = sim.state
  for (let i = 0; i < 600 && !s.restart?.ready; i++) sim.step()
  sim.step([{ type: 'Pass', dir: { x: 0, y: -1 }, through: false }])
  for (let i = 0; i < 30; i++) sim.step()
  s.phase = 'play'
  s.restart = null
  const b = s.ball
  b.ownerId = null
  b.mode = 'free'
  b.lastTouchTeam = 1
  b.lastTouchId = 6
  b.intendedReceiverId = null
  if (kind === 'kickIn') {
    b.pos = { x: 9.5, y: 2 }
    b.vel = { x: 6, y: 0 }
  } else {
    // Team 0 attacks +y: the ball goes over the +y goal line off a defender -> corner for team 0.
    b.pos = { x: 6, y: 19.5 }
    b.vel = { x: 0, y: 6 }
  }
  const restart = () => sim.state.restart
  for (let i = 0; i < TICK_RATE * 8 && !(restart()?.ready && restart()?.type === kind); i++) sim.step()
  expect(restart()?.type).toBe(kind)
  expect(restart()?.ready).toBe(true)
  return { sim, s, taker: sim.player(restart()!.takerId) }
}

describe('the taker stays behind the ball as the aim changes', () => {
  it('kick-off: the taker is behind the ball, facing the opponent half', () => {
    const sim = new MatchSimulation({ seed: 4, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: 0 })
    const s = sim.state
    for (let i = 0; i < 600 && !s.restart?.ready; i++) sim.step()
    const taker = sim.player(s.restart!.takerId)
    const dir = s.teams[s.restart!.team].attackDir
    expect((s.ball.pos.y - taker.pos.y) * dir).toBeGreaterThan(0.25)
    expect(Math.abs(s.ball.pos.x - taker.pos.x)).toBeLessThan(0.15)
    expect(Math.sin(taker.facing) * dir).toBeGreaterThan(0.9)
  })

  it('kick-in aimed diagonally: the taker steps round so the ball is in front along that line', () => {
    const { sim, s, taker } = humanRestart('kickIn')
    const spot = { ...s.restart!.spot }
    // Ball went out at sim +x; aim diagonally into the court and towards -y.
    const aim = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 }
    for (let i = 0; i < 50; i++) sim.step([{ type: 'Move', dir: aim, sprint: false, sole: false }])
    expect(s.ball.pos).toEqual(spot) // the ball stays on the line
    const to = { x: s.ball.pos.x - taker.pos.x, y: s.ball.pos.y - taker.pos.y }
    const along = to.x * aim.x + to.y * aim.y
    const across = Math.abs(to.x * aim.y - to.y * aim.x)
    expect(along).toBeGreaterThan(0.4)
    expect(across).toBeLessThan(0.12)
    // Facing the aim, through the ball.
    expect(Math.cos(taker.facing) * aim.x + Math.sin(taker.facing) * aim.y).toBeGreaterThan(0.9)
    // Turning the aim the other way walks him round to the other side.
    const aim2 = { x: -Math.SQRT1_2, y: Math.SQRT1_2 }
    for (let i = 0; i < 60; i++) sim.step([{ type: 'Move', dir: aim2, sprint: false, sole: false }])
    const to2 = { x: s.ball.pos.x - taker.pos.x, y: s.ball.pos.y - taker.pos.y }
    expect(to2.x * aim2.x + to2.y * aim2.y).toBeGreaterThan(0.4)
    expect(s.ball.pos).toEqual(spot)
  })

  it('a kick-in cannot be aimed back out of the court; the taker stays outside the line', () => {
    const { sim, s, taker } = humanRestart('kickIn')
    for (let i = 0; i < 50; i++)
      sim.step([{ type: 'Move', dir: { x: 1, y: 0.1 }, sprint: false, sole: false }])
    // Inward for a kick-in on the +x line is -x.
    expect(-s.restart!.aimDir.x).toBeGreaterThanOrEqual(0.15 - 1e-9)
    expect(taker.pos.x).toBeGreaterThan(COURT.halfWidth)
  })

  it('corner: the aim is limited to the court quarter and the ball stays in front of the taker', () => {
    const { sim, s, taker } = humanRestart('corner')
    const spot = { ...s.restart!.spot }
    // Try to aim along the goal line, out of the court.
    for (let i = 0; i < 50; i++) sim.step([{ type: 'Move', dir: { x: 0, y: 1 }, sprint: false, sole: false }])
    const aim = s.restart!.aimDir
    expect(aim.y * -Math.sign(spot.y)).toBeGreaterThan(0)
    expect(aim.x * -Math.sign(spot.x)).toBeGreaterThan(0)
    const to = { x: s.ball.pos.x - taker.pos.x, y: s.ball.pos.y - taker.pos.y }
    expect(to.x * aim.x + to.y * aim.y).toBeGreaterThan(0.4)
    expect(s.ball.pos).toEqual(spot)
  })

  it('AI takers line up behind the ball towards their receiver and kick it that way', () => {
    let checked = 0
    for (const seed of [1, 2, 3, 5, 7]) {
      const sim = aiSim(seed)
      const s = sim.state
      let lastTo: { x: number; y: number } | null = null
      for (let i = 0; i < TICK_RATE * 200 && checked < 10; i++) {
        const r = s.restart
        if (r?.ready && (r.type === 'kickIn' || r.type === 'corner')) {
          const t = sim.player(r.takerId)
          lastTo = { x: s.ball.pos.x - t.pos.x, y: s.ball.pos.y - t.pos.y }
        }
        sim.step()
        const resumed = sim.drainEvents().some((e) => e.type === 'PlayResumed')
        if (resumed && lastTo) {
          const v = s.ball.vel
          const cos =
            (v.x * lastTo.x + v.y * lastTo.y) / (Math.hypot(v.x, v.y) * Math.hypot(lastTo.x, lastTo.y))
          expect(cos).toBeGreaterThan(0.8)
          checked++
        }
        if (!s.restart) lastTo = null
      }
    }
    expect(checked).toBeGreaterThan(3)
  })
})
