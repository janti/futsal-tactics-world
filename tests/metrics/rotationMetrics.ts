/**
 * AI vs AI measurements for the rotation library (not part of `npm test`; run with
 * `npm run metrics`). Team 0 plays the formation under test (rotations on / off), team 1 the
 * default 3-1. Everything is seeded: the same code gives the same numbers.
 */
import { TEAM_LIBRARY } from '../../src/data/teams'
import { MatchSimulation } from '../../src/simulation/MatchSimulation'
import type { TeamTactics } from '../../src/simulation/Tactics'
import { TICK_RATE } from '../../src/simulation/SimulationConfig'
import { laneOpenness } from '../../src/physics/PassingPhysics'
import { passInterceptable } from '../../src/ai/passing'
import { dist } from '../../src/core/math/vec2'
import { ROTATION_KINDS } from '../../src/ai/team/rotations'

export interface Metrics {
  label: string
  minutes: number
  passes: number
  passCompletion: number
  turnovers: number
  shots: number
  goals: number
  conceded: number
  finalThirdEntries: number
  /** Average distance (m) from each outfield player in possession to his nearest teammate. */
  spacing: number
  /** Share of possession samples with two outfield teammates closer than 2.5 m. */
  congestion: number
  /** Teammates with an open, safe lane per carrier sample. */
  passOptions: number
  /** Shots conceded within 8 s of losing the ball in open play. */
  counterShotsConceded: number
  /** Passes from our outfield players to our own keeper. */
  keeperPasses: number
  rotationsStarted: number
  rotationsCompleted: number
  aiMsPerMinute: number
}

export function measure(
  label: string,
  tactics: Partial<TeamTactics>,
  seeds: readonly number[],
  seconds: number,
): Metrics {
  let passes = 0
  let completed = 0
  let turnovers = 0
  let shots = 0
  let goals = 0
  let conceded = 0
  let entries = 0
  let spacing = 0
  let spacingN = 0
  let congested = 0
  let possN = 0
  let options = 0
  let optionsN = 0
  let counterShots = 0
  let started = 0
  let done = 0
  let keeperPasses = 0
  let ms = 0
  for (const seed of seeds) {
    const sim = new MatchSimulation({
      seed,
      home: TEAM_LIBRARY[0]!,
      away: TEAM_LIBRARY[1]!,
      humanTeam: null,
      tactics: [tactics, {}],
    })
    const s = sim.state
    let lastLoss = -Infinity
    let inFinalThird = false
    const t0 = performance.now()
    for (let i = 0; i < TICK_RATE * seconds; i++) {
      const prevPoss = s.possessionTeam
      const prevPhase = s.phase
      sim.step()
      for (const e of sim.drainEvents()) {
        if (e.type === 'PassStarted' && e.receiverId !== null && sim.player(e.playerId).team === 0) {
          passes++
          if (sim.player(e.receiverId).role === 'GK' && sim.player(e.playerId).role !== 'GK') keeperPasses++
        }
        if (e.type === 'PassCompleted' && sim.player(e.playerId).team === 0) completed++
        if (e.type === 'ShotTaken') {
          if (e.team === 0) shots++
          else if (s.time - lastLoss < 8) counterShots++
        }
        if (e.type === 'GoalScored') {
          if (e.team === 0) goals++
          else conceded++
        }
      }
      if (prevPoss === 0 && s.possessionTeam === 1 && prevPhase === 'play' && s.phase === 'play') {
        turnovers++
        lastLoss = s.time
      }
      // Final-third entries: our carrier inside 13 m of the goal attacked (counted once per entry).
      const owner = s.ball.ownerId !== null ? s.players[s.ball.ownerId]! : null
      const dir = s.teams[0].attackDir
      const deep = owner?.team === 0 && owner.role !== 'GK' && (dir * 20 - owner.pos.y) * dir < 13
      if (deep && !inFinalThird) entries++
      inFinalThird = !!deep || (inFinalThird && s.possessionTeam === 0)
      if (i % 15 !== 0 || s.phase !== 'play' || s.possessionTeam !== 0) continue
      const mine = s.players.filter((p) => p.team === 0 && p.role !== 'GK')
      possN++
      let close = false
      for (const p of mine) {
        let nd = Infinity
        for (const q of mine) if (q.id !== p.id) nd = Math.min(nd, dist(p.pos, q.pos))
        spacing += nd
        spacingN++
        if (nd < 2.5) close = true
      }
      if (close) congested++
      if (owner?.team === 0 && owner.role !== 'GK') {
        optionsN++
        for (const q of mine)
          if (
            q.id !== owner.id &&
            laneOpenness(s, 0, owner.pos, q.pos) > 1 &&
            !passInterceptable(s, 0, owner.pos, q.pos)
          )
            options++
      }
    }
    ms += performance.now() - t0
    for (const k of ROTATION_KINDS) {
      started += s.rotationStats[0][k]?.started ?? 0
      done += s.rotationStats[0][k]?.completed ?? 0
    }
  }
  const minutes = (seeds.length * seconds) / 60
  const per36 = (n: number) => +((n * 36) / minutes).toFixed(1)
  return {
    label,
    minutes,
    passes: per36(passes),
    passCompletion: +(completed / Math.max(1, passes)).toFixed(3),
    turnovers: per36(turnovers),
    shots: per36(shots),
    goals: per36(goals),
    conceded: per36(conceded),
    finalThirdEntries: per36(entries),
    spacing: +(spacing / Math.max(1, spacingN)).toFixed(2),
    congestion: +(congested / Math.max(1, possN)).toFixed(3),
    passOptions: +(options / Math.max(1, optionsN)).toFixed(2),
    counterShotsConceded: per36(counterShots),
    keeperPasses: per36(keeperPasses),
    rotationsStarted: per36(started),
    rotationsCompleted: per36(done),
    aiMsPerMinute: +(ms / minutes).toFixed(0),
  }
}
