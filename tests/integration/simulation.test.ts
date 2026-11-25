import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import type { Command } from '../../src/simulation/Commands'
import type { DefensiveSwitchMode } from '../../src/simulation/ControlOptions'
import type { MatchEvent } from '../../src/simulation/Events'
import { MatchSimulation } from '../../src/simulation/MatchSimulation'
import type { MatchState } from '../../src/simulation/MatchState'
import { RESTART, TICK_RATE } from '../../src/simulation/SimulationConfig'

function newSim(seed = 99, humanTeam: 0 | 1 | null = 0, defensiveSwitch?: DefensiveSwitchMode) {
  return new MatchSimulation({
    seed,
    home: TEAM_LIBRARY[0]!,
    away: TEAM_LIBRARY[1]!,
    humanTeam,
    ...(defensiveSwitch ? { control: { defensiveSwitch } } : {}),
  })
}

function hashState(s: MatchState): string {
  const r = (n: number) => n.toFixed(6)
  return [
    s.tick,
    s.score.join(':'),
    r(s.ball.pos.x),
    r(s.ball.pos.y),
    r(s.ball.z),
    s.ball.ownerId,
    s.controlledId,
    ...s.players.map((p) => `${r(p.pos.x)},${r(p.pos.y)},${r(p.facing)}`),
    s.rngState,
  ].join('|')
}

/** A scripted command stream: run up-court, pass, switch, shoot. */
function scriptedCommands(tick: number): Command[] {
  const dir = { x: Math.sin(tick / 40) * 0.5, y: 1 }
  const cmds: Command[] = [{ type: 'Move', dir, sprint: tick % 200 < 80, sole: tick % 300 > 280 }]
  if (tick % 150 === 100) cmds.push({ type: 'Pass', dir, through: tick % 300 === 100 })
  if (tick % 400 === 390) cmds.push({ type: 'Shoot', dir, power: 0.8 })
  if (tick % 250 === 10) cmds.push({ type: 'SwitchPlayer', dir })
  if (tick === 1500) cmds.push({ type: 'SetControlOptions', options: { defensiveSwitch: 'assisted' } })
  return cmds
}

function runUntil(
  sim: MatchSimulation,
  pred: (e: MatchEvent[]) => boolean,
  maxTicks: number,
  cmds: (t: number) => Command[] = () => [],
) {
  for (let i = 0; i < maxTicks; i++) {
    sim.step(cmds(sim.state.tick))
    if (pred(sim.drainEvents())) return true
  }
  return false
}

/** Step until the current restart's taker is at the ball (ready to kick). */
function untilReady(sim: MatchSimulation, maxTicks = 600): boolean {
  for (let i = 0; i < maxTicks; i++) {
    if (sim.state.restart?.ready) return true
    sim.step()
  }
  return sim.state.restart?.ready ?? false
}

/** Human kick-off: wait until ready, play it back to the fixo and wait until it arrives. */
function kickOff(sim: MatchSimulation) {
  expect(untilReady(sim)).toBe(true)
  sim.step([{ type: 'Pass', dir: { x: 0, y: -1 }, through: false }])
  expect(runUntil(sim, (e) => e.some((x) => x.type === 'PassCompleted'), 180)).toBe(true)
  sim.drainEvents()
}

describe('determinism', () => {
  it('identical seeds and command streams produce identical matches', () => {
    const a = newSim(1234)
    const b = newSim(1234)
    for (let i = 0; i < 3600; i++) {
      a.step(scriptedCommands(i))
      b.step(scriptedCommands(i))
    }
    expect(hashState(a.state)).toBe(hashState(b.state))
  })

  it('different seeds diverge', () => {
    const a = newSim(1)
    const b = newSim(2)
    for (let i = 0; i < 1200; i++) {
      a.step(scriptedCommands(i))
      b.step(scriptedCommands(i))
    }
    expect(hashState(a.state)).not.toBe(hashState(b.state))
  })
})

describe('human control', () => {
  it('kick-off: play restarts only when the ball is kicked, then the receiver can dribble', () => {
    const sim = newSim()
    expect(untilReady(sim)).toBe(true)
    expect(sim.state.phase).toBe('restart')
    expect(sim.state.ball.ownerId).toBe(sim.state.controlledId)
    kickOff(sim)
    expect(sim.state.phase).toBe('play')
    const p = sim.player(sim.state.controlledId!)
    expect(sim.state.ball.ownerId).toBe(p.id)
    const startX = p.pos.x
    for (let i = 0; i < 30; i++) sim.step([{ type: 'Move', dir: { x: 1, y: 0 }, sprint: false, sole: false }])
    expect(p.pos.x).toBeGreaterThan(startX + 0.8)
    expect(sim.state.ball.ownerId).toBe(p.id)
  })

  it('passing moves control to the receiver and the pass is completed', () => {
    const sim = newSim()
    kickOff(sim)
    const passer = sim.state.controlledId!
    sim.step([{ type: 'Pass', dir: { x: 1, y: 0.2 }, through: false }])
    const started = sim.drainEvents().find((e) => e.type === 'PassStarted')
    expect(started).toBeDefined()
    expect(sim.state.controlledId).not.toBe(passer)
  })

  it('the player can shoot and score: a goal updates the score and the opponents kick off', () => {
    let goals = 0
    let checkedRestart = false
    for (const seed of [3, 4, 5, 6, 7, 8, 9, 10]) {
      const sim = newSim(seed)
      kickOff(sim)
      // Scenario: controlled attacker on the ball 8 m out, outfield defenders far away.
      const p = sim.player(sim.state.controlledId!)
      p.pos = { x: 1.5, y: 12 }
      p.vel = { x: 0, y: 0 }
      p.facing = Math.PI / 2
      sim.state.ball.ownerId = p.id
      sim.state.ball.pos = { x: 1.5, y: 12.4 }
      sim.state.ball.vel = { x: 0, y: 0 }
      for (const o of sim.state.players) if (o.team === 1 && o.role !== 'GK') o.pos = { x: o.pos.x, y: -12 }
      sim.step([{ type: 'Shoot', dir: { x: 1, y: 1 }, power: 0.3 }]) // quick low placed shot
      expect(sim.drainEvents().some((e) => e.type === 'ShotTaken')).toBe(true)
      if (!runUntil(sim, (e) => e.some((x) => x.type === 'GoalScored'), 120)) continue
      goals++
      expect(sim.state.score[0]).toBe(1)
      if (!checkedRestart) {
        expect(untilReady(sim, 900)).toBe(true)
        expect(sim.state.restart!.type).toBe('kickoff')
        expect(sim.state.restart!.team).toBe(1)
        // The AI kicks off with a pass.
        expect(runUntil(sim, (e) => e.some((x) => x.type === 'PlayResumed'), 120)).toBe(true)
        checkedRestart = true
      }
    }
    // Good chances are usually, but not always, converted (the keeper can save).
    expect(goals).toBeGreaterThanOrEqual(3)
    expect(checkedRestart).toBe(true)
  })

  it('a ball kicked over the touch line produces a kick-in for the other team', () => {
    const sim = newSim()
    kickOff(sim)
    const ball = sim.state.ball
    sim.step([{ type: 'Pass', dir: { x: -1, y: 0 }, through: true }])
    ball.vel = { x: -18, y: 0 }
    ball.intendedReceiverId = null
    const out = runUntil(
      sim,
      (e) => e.some((x) => x.type === 'BallOut' && x.restart === 'kickIn' && x.team === 1),
      240,
    )
    expect(out).toBe(true)
    expect(sim.state.phase).toBe('restart')
    // The ball keeps flying off the court first (no teleport)...
    expect(sim.state.restart!.ballPlaced).toBe(false)
    const x0 = Math.abs(sim.state.ball.pos.x)
    sim.step()
    expect(Math.abs(sim.state.ball.pos.x)).toBeGreaterThan(x0)
    // ...hits the boards and is then placed on the touch line for the kick-in.
    let wall = false
    for (let i = 0; i < TICK_RATE * (RESTART.outFlightMax + 0.5) && !sim.state.restart!.ballPlaced; i++) {
      sim.step()
      wall ||= sim.drainEvents().some((e) => e.type === 'WallHit')
    }
    expect(wall).toBe(true)
    expect(sim.state.restart!.ballPlaced).toBe(true)
    expect(Math.abs(sim.state.ball.pos.x)).toBe(10)
  })

  it('switching selects another outfield player, never the goalkeeper', () => {
    const sim = newSim()
    kickOff(sim)
    // Make the ball loose far away (last touched by us, so we are not defending).
    sim.state.ball.ownerId = null
    sim.state.ball.mode = 'free'
    sim.state.ball.pos = { x: 6, y: 12 }
    sim.state.ball.vel = { x: 0, y: 0 }
    const before = sim.state.controlledId
    sim.step([{ type: 'SwitchPlayer', dir: { x: 0, y: 0 } }])
    expect(sim.state.controlledId).not.toBe(before)
    expect(sim.player(sim.state.controlledId!).role).not.toBe('GK')
  })
})

/** Put the ball at the feet of an opponent and place human players at given positions. */
function defendingScenario(mode: DefensiveSwitchMode, positions: Record<number, { x: number; y: number }>) {
  const sim = newSim(99, 0, mode)
  kickOff(sim)
  const s = sim.state
  const carrier = sim.player(9)
  carrier.pos = { x: 0, y: 0 }
  carrier.vel = { x: 0, y: 0 }
  s.ball.ownerId = carrier.id
  s.ball.mode = 'controlled'
  s.ball.pos = { x: 0, y: -0.4 }
  s.ball.vel = { x: 0, y: 0 }
  s.ball.lastTouchTeam = 1
  s.possessionTeam = 1
  for (const [id, pos] of Object.entries(positions)) {
    const p = sim.player(Number(id))
    p.pos = pos
    p.vel = { x: 0, y: 0 }
  }
  // Keep the other opponents out of the way.
  for (const id of [6, 7, 8]) sim.player(id).pos = { x: -8 + id, y: 15 }
  s.switchCooldown = 0
  s.autoSwitchHold = 0
  return sim
}

describe('defensive player selection', () => {
  it('nearest mode (default): control moves to the outfield player nearest the ball', () => {
    const sim = defendingScenario('nearest', {
      4: { x: 0, y: 12 },
      1: { x: 0, y: -2 },
      2: { x: 6, y: 6 },
      3: { x: -6, y: 6 },
    })
    expect(sim.state.control.defensiveSwitch).toBe('nearest')
    sim.state.controlledId = 4
    sim.step()
    expect(sim.state.controlledId).toBe(1)
  })

  it('nearest mode is the default for a new match', () => {
    expect(newSim().state.control.defensiveSwitch).toBe('nearest')
  })

  it('nearest mode uses hysteresis: a slightly closer player does not steal control', () => {
    const sim = defendingScenario('nearest', {
      4: { x: 0, y: -3 },
      1: { x: 0, y: -2.6 },
      2: { x: 8, y: 8 },
      3: { x: -8, y: 8 },
    })
    sim.state.controlledId = 4
    sim.step()
    expect(sim.state.controlledId).toBe(4)
  })

  it('nearest mode does not flicker: at most a few switches per second while defending', () => {
    const sim = defendingScenario('nearest', { 4: { x: 0, y: 12 } })
    let switches = 0
    for (let i = 0; i < TICK_RATE * 5; i++) {
      sim.step()
      switches += sim.drainEvents().filter((e) => e.type === 'PlayerSwitched').length
    }
    expect(switches / 5).toBeLessThanOrEqual(1 / 0.4 + 1e-9)
  })

  it('a manual switch temporarily overrides nearest mode', () => {
    const sim = defendingScenario('nearest', {
      4: { x: 0, y: -2 },
      1: { x: 0, y: -7 },
      2: { x: 8, y: 8 },
      3: { x: -8, y: 8 },
    })
    sim.state.controlledId = 4
    sim.step([{ type: 'SwitchPlayer', dir: { x: 0, y: -1 } }])
    const chosen = sim.state.controlledId
    expect(chosen).not.toBe(4)
    expect(sim.state.autoSwitchHold).toBeGreaterThan(0)
    for (let i = 0; i < 30; i++) sim.step()
    expect(sim.state.controlledId).toBe(chosen)
  })

  it('manual mode never switches the defending player automatically', () => {
    // Player 1 is much nearer the ball, but far enough not to win it within the test window.
    const sim = defendingScenario('manual', {
      4: { x: 0, y: 12 },
      1: { x: 0, y: -6 },
      2: { x: 8, y: 10 },
      3: { x: -8, y: 10 },
    })
    sim.state.controlledId = 4
    for (let i = 0; i < 20; i++) sim.step()
    expect(sim.state.controlledId).toBe(4)
  })

  it('assisted mode hands control to the defender nearest an opponent pass target', () => {
    const sim = defendingScenario('assisted', {
      4: { x: -6, y: 10 },
      2: { x: 5, y: -4 },
      1: { x: -8, y: 12 },
      3: { x: -8, y: 14 },
    })
    const s = sim.state
    const opp = sim.player(9)
    const oppReceiver = sim.player(8)
    oppReceiver.pos = { x: 6, y: -6 }
    s.controlledId = 4
    sim.pass(opp, { x: 6, y: -6 }, false, oppReceiver)
    expect(s.controlledId).toBe(2)
  })

  it('the mode can be changed mid-match with a command', () => {
    const sim = newSim()
    sim.step([{ type: 'SetControlOptions', options: { defensiveSwitch: 'manual' } }])
    expect(sim.state.control.defensiveSwitch).toBe('manual')
  })
})

/** Force the ball over the left touch line, last touched by the opponents: kick-in for the human team. */
function humanKickIn(sim: MatchSimulation) {
  kickOff(sim)
  const b = sim.state.ball
  b.ownerId = null
  b.mode = 'free'
  b.pos = { x: 9.5, y: 2 }
  b.vel = { x: 6, y: 0 }
  b.lastTouchId = 6
  b.lastTouchTeam = 1
  b.intendedReceiverId = null
  expect(
    runUntil(sim, (e) => e.some((x) => x.type === 'BallOut' && x.restart === 'kickIn' && x.team === 0), 60),
  ).toBe(true)
  expect(untilReady(sim)).toBe(true)
}

describe('kick-ins and set pieces', () => {
  it('the kick-in taker cannot dribble: input only turns him round the ball, which stays on the line', () => {
    const sim = newSim()
    humanKickIn(sim)
    const s = sim.state
    const taker = sim.player(s.restart!.takerId)
    const bp = { ...s.ball.pos }
    for (let i = 0; i < 90; i++)
      sim.step([{ type: 'Move', dir: { x: -1, y: 0.5 }, sprint: true, sole: false }])
    expect(s.phase).toBe('restart')
    expect(s.ball.pos).toEqual(bp)
    // He never leaves the ball: at most a step behind it.
    expect(Math.hypot(taker.pos.x - bp.x, taker.pos.y - bp.y)).toBeLessThan(0.65)
  })

  it('play restarts with the kick, and the taker may not touch the ball again first (no double touch)', () => {
    const sim = newSim()
    humanKickIn(sim)
    const s = sim.state
    const takerId = s.restart!.takerId
    sim.step([{ type: 'Pass', dir: { x: -1, y: 0 }, through: false }])
    const events = sim.drainEvents()
    expect(events.some((e) => e.type === 'PlayResumed')).toBe(true)
    expect(s.phase).toBe('play')
    expect(s.ball.blockedTouchId).toBe(takerId)
    // Roll the ball back onto the taker with everyone else far away: the taker cannot play it.
    for (const p of s.players) if (p.id !== takerId) p.pos = { x: -8, y: p.team === 0 ? -15 : 15 }
    const taker = sim.player(takerId)
    taker.touchCooldown = 0
    s.ball.pos = { x: taker.pos.x - 1.5, y: taker.pos.y }
    s.ball.vel = { x: 1.8, y: 0 }
    s.ball.intendedReceiverId = null
    for (let i = 0; i < 60; i++) {
      sim.step()
      expect(s.ball.ownerId).not.toBe(takerId)
    }
    // Once a teammate has touched the ball, the restriction is lifted.
    const mate = sim.player(takerId === 1 ? 2 : 1)
    mate.pos = { x: s.ball.pos.x, y: s.ball.pos.y - 0.3 }
    s.ball.vel = { x: 0, y: 0 }
    sim.step()
    expect(s.ball.ownerId).toBe(mate.id)
    expect(s.ball.blockedTouchId).toBeNull()
  })

  it('four-second rule: a kick-in not taken in time goes to the opponents', () => {
    const sim = newSim()
    humanKickIn(sim)
    const spot = { ...sim.state.restart!.spot }
    const ok = runUntil(
      sim,
      (e) => e.some((x) => x.type === 'RestartTimeout' && x.restart === 'kickIn' && x.team === 0),
      Math.ceil((RESTART.kickTimeLimit + 0.2) * TICK_RATE),
    )
    expect(ok).toBe(true)
    expect(sim.state.restart!.type).toBe('kickIn')
    expect(sim.state.restart!.team).toBe(1)
    expect(sim.state.restart!.spot).toEqual(spot)
  })

  it('AI takers kick (never dribble) their kick-ins within the time limit', () => {
    let kickIns = 0
    let maxReady = 0
    for (const seed of [5, 6, 7, 8]) {
      const sim = newSim(seed, null)
      let readyTicks = 0
      for (let i = 0; i < TICK_RATE * 180; i++) {
        const r = sim.state.restart
        if (r?.ready) {
          const taker = sim.player(r.takerId)
          expect(Math.hypot(sim.state.ball.pos.x - r.spot.x, sim.state.ball.pos.y - r.spot.y)).toBeLessThan(
            1e-9,
          )
          expect(Math.hypot(taker.vel.x, taker.vel.y)).toBeLessThan(2)
          readyTicks++
        } else {
          maxReady = Math.max(maxReady, readyTicks)
          readyTicks = 0
        }
        sim.step()
        for (const e of sim.drainEvents()) {
          if (e.type === 'BallOut' && e.restart === 'kickIn') kickIns++
          expect(e.type).not.toBe('RestartTimeout')
        }
      }
    }
    expect(kickIns).toBeGreaterThan(0)
    expect(maxReady / TICK_RATE).toBeLessThan(RESTART.kickTimeLimit)
  })
})
