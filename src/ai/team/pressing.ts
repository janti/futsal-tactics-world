/**
 * Pressing triggers (Milestone 6, stage 2). A defending team does not press flat out all the time: it
 * waits for a cue and then jumps — the presser goes in tight wherever the ball is, a second man comes
 * to trap the carrier and everybody else marks tight. The cues:
 * - `backPass`: the opponents play the ball back towards their own goal (to the keeper, to the
 *   deepest man); the press goes to the receiver while the ball travels.
 * - `backToGoal`: a carrier who has just received facing his own goal.
 * - `poorTouch`: the ball has got away from an opponent (a heavy touch): nobody has it.
 * - `touchline`: the carrier by the touch line — the line is an extra defender, he is trapped there.
 * The pressing height decides how far up the court the team reacts (a low block only near its own
 * goal). A jump lasts `PRESS_TRIGGER.duration`.
 */
import { dist } from '../../core/math/vec2'
import type { MatchState, PlayerState, PressTriggerKind, TeamId } from '../../simulation/MatchState'
import { COURT } from '../../simulation/SimulationConfig'
import { deepestOutfield } from '../common'

export const PRESS_TRIGGER = {
  /** Seconds a jump lasts. */
  duration: 1.6,
  /** The cue counts only with the ball within this distance of the defending team's goal. */
  reach: { low: 21, mid: 30, high: 45 },
  /** The carrier is "by the touch line" within this distance of it. */
  touchline: 1.8,
} as const

/** The defending team's jump is on. */
export function pressTriggerActive(state: MatchState, team: TeamId): boolean {
  const t = state.pressTrigger[team]
  return t !== null && state.time < t.until
}

/** Detect cues and start / end jumps (call once per tick before the AI decisions). */
export function updatePressTriggers(state: MatchState): void {
  for (const team of [0, 1] as const) {
    const cur = state.pressTrigger[team]
    // Ball dead, or we have it: no jump.
    if (state.phase !== 'play' || state.possessionTeam === team) {
      state.pressTrigger[team] = null
      continue
    }
    if (cur && state.time >= cur.until) state.pressTrigger[team] = null
    if (state.pressTrigger[team]) continue
    const cue = detectCue(state, team)
    if (cue)
      state.pressTrigger[team] = {
        kind: cue.kind,
        until: state.time + PRESS_TRIGGER.duration,
        targetId: cue.targetId,
      }
  }
}

function detectCue(
  state: MatchState,
  team: TeamId,
): { kind: PressTriggerKind; targetId: number | null } | null {
  const ball = state.ball
  const ownGoal = { x: 0, y: -state.teams[team].attackDir * COURT.halfLength }
  if (dist(ball.pos, ownGoal) > PRESS_TRIGGER.reach[state.teams[team].tactics.pressing]) return null
  const opp: TeamId = team === 0 ? 1 : 0
  const oppDir = state.teams[opp].attackDir
  const owner = ball.ownerId !== null ? state.players[ball.ownerId]! : null
  // A ball travelling back towards their own goal, to a teammate deeper than where it came from.
  if (
    !owner &&
    ball.mode === 'free' &&
    ball.lastTouchTeam === opp &&
    ball.intendedReceiverId !== null &&
    !ball.isShot
  ) {
    const r = state.players[ball.intendedReceiverId]!
    if (
      r.team === opp &&
      ball.vel.y * oppDir < -2 &&
      (r.role === 'GK' || deepestOutfield(state, opp) === r.id)
    )
      return { kind: 'backPass', targetId: r.id }
  }
  // A loose ball that got away from them (not a pass, not a shot).
  if (
    !owner &&
    ball.mode === 'free' &&
    ball.lastTouchTeam === opp &&
    ball.intendedReceiverId === null &&
    !ball.isShot &&
    ball.lastKickerId === null &&
    ball.z < 0.5
  )
    return { kind: 'poorTouch', targetId: null }
  if (!owner || owner.team !== opp || owner.role === 'GK' || ball.inHands) return null
  // Just received facing his own goal.
  if (owner.aiHoldTimer < 0.6 || owner.id === state.controlledId) {
    if (backToOwnGoal(state, owner)) return { kind: 'backToGoal', targetId: owner.id }
  }
  // By the touch line.
  if (COURT.halfWidth - Math.abs(owner.pos.x) < PRESS_TRIGGER.touchline)
    return { kind: 'touchline', targetId: owner.id }
  return null
}

function backToOwnGoal(state: MatchState, p: PlayerState): boolean {
  return Math.sin(p.facing) * state.teams[p.team].attackDir < -0.45
}
