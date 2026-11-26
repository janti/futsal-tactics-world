/** Restart behaviour: takers and the positions of everybody else at set pieces. */
import { clamp } from '../core/math/scalar'
import type { SeededRandom } from '../core/random/SeededRandom'
import { dist, sub, type Vec2 } from '../core/math/vec2'
import { laneOpenness, predictPassTarget } from '../physics/PassingPhysics'
import type { MatchState, PlayerState } from '../simulation/MatchState'
import { COURT, PASS, RESTART } from '../simulation/SimulationConfig'
import { dynamicAnchor } from './positioning/Formation'
import { clampRestartAim, restartTakerSpot } from '../simulation/RestartGeometry'
import { type AIActions, GOAL_CLEARANCE_ALA_DROP, kickoffAnchor } from './common'
import { walkTo, keepDistance } from './movement'
import { markingPosition } from './team/defending'
import { setPieceRoutine } from './team/attacking'
import { bestPassOption } from './passing'

export function restartBehaviour(
  state: MatchState,
  p: PlayerState,
  actions: AIActions,
  rng: SeededRandom,
  dt: number,
): void {
  const r = state.restart!
  if (r.takerId === p.id) {
    if (r.ready && state.ball.ownerId === p.id) {
      // Kick-in / corner / kick-off: the ball must be kicked, never dribbled. Pick a pass in time.
      p.moveIntent = { x: 0, y: 0 }
      p.aiHoldTimer += dt
      let best = bestPassOption(state, p, rng)
      // Set-piece routine: once the movement has started, play the most open of the three runners
      // (the short man first, then the pivot coming out, then the deep man).
      const routine = setPieceRoutine(state, p.team)
      let shooter: PlayerState | null = null
      if (routine && r.readyTimer > 1.1) {
        let bestS = -Infinity
        for (const rr of routine) {
          const q = state.players[rr.id]!
          const lane = laneOpenness(state, p.team, r.spot, q.pos)
          if (lane < 0.6) continue
          let space = Infinity
          for (const o of state.players)
            if (o.team !== p.team && o.role !== 'GK') space = Math.min(space, dist(o.pos, q.pos))
          // Enough room is enough: the short man and the pivot are preferred (they can shoot).
          if (space < 1.1) continue
          const pref = rr.role === 'short' ? 1.3 : rr.role === 'pivot' ? 1.0 : 0
          const sc = Math.min(lane, 2) * 0.5 + Math.min(space, 2.5) * 0.5 + pref
          if (sc > bestS) {
            bestS = sc
            shooter = rr.role === 'deep' ? null : q
            best = { player: q, score: sc }
          }
        }
      }
      if (best) {
        // Aim where the receiver will meet the ball: the taker steps round the ball to stand behind
        // it on that line.
        const meet = predictPassTarget(p, best.player, false, state.teams[p.team].attackDir)
        r.aimDir = clampRestartAim(state, r, sub(meet, r.spot))
        p.faceTarget = best.player.pos
      }
      const wait = r.type === 'kickoff' ? 0.5 : routine ? 1.8 : 0.9
      // Kick only once he stands behind the ball on the aim line (he walks round it when re-aiming).
      // Never let the four-second limit run out: after 2.6 s the ball goes regardless.
      const hurry = r.readyTimer > 2.8
      const inPlace = dist(p.pos, restartTakerSpot(state, r)) < 0.15
      if (best && ((p.aiHoldTimer >= wait && inPlace) || hurry)) {
        if (routine && routine.some((rr) => rr.id === best!.player.id)) {
          // The routine ball is played firmly so it beats a marker; the short man and the pivot strike
          // it first time if they are in range.
          if (shooter) shooter.aiSetPieceTimer = 2.5
          const arrival = clamp(dist(best.player.pos, r.spot) * 0.9, 6.5, PASS.setPieceArrival)
          actions.pass(p, r.aimDir, false, best.player, undefined, arrival)
        } else actions.pass(p, r.aimDir, false, best.player)
      }
      return
    }
    // Walk to the taker's spot behind the ball (the ball ends up in front of him on the line).
    const spot = restartTakerSpot(state, r)
    walkTo(p, spot, dist(p.pos, spot) > 4)
    p.faceTarget = r.type === 'kickoff' ? null : { x: 0, y: 0 }
    return
  }
  let target: Vec2
  if (r.type === 'kickoff') {
    target = kickoffAnchor(state, p)
  } else {
    const mode = r.team === p.team ? 'attack' : 'defend'
    const dir = state.teams[p.team].attackDir
    target = dynamicAnchor(p.role, mode, dir, r.spot)
    // Goal clearance: the alas start a metre deeper so the keeper has an easier angle out to the wing.
    if (r.type === 'goalClearance' && r.team === p.team && (p.role === 'ALA_L' || p.role === 'ALA_R'))
      target = { x: target.x, y: target.y - dir * GOAL_CLEARANCE_ALA_DROP }
    const routineSpot =
      p.role !== 'GK' ? setPieceRoutine(state, r.team)?.find((rr) => rr.id === p.id)?.spot : undefined
    if (routineSpot && r.team === p.team) target = routineSpot
    else if (r.team !== p.team && p.role !== 'GK' && (r.type === 'kickIn' || r.type === 'corner'))
      target = markingPosition(state, p, [])
    if (r.team !== p.team && p.role === 'GK' && r.type === 'freeKick') {
      // Free kick near goal: the keeper stays on his line between the posts.
      target = { x: clamp(r.spot.x * 0.3, -1, 1), y: -dir * (COURT.halfLength - 0.4) }
    } else if (r.team !== p.team) {
      target = keepDistance(target, r.spot, RESTART.opponentDistance + 0.3)
      // Pushed back over the own goal line (free kick on the area line): stand on the goal line
      // between the posts instead, which the rules allow.
      if (target.y * -dir > COURT.halfLength - 0.4)
        target = { x: clamp(target.x, -1.3, 1.3), y: -dir * (COURT.halfLength - 0.4) }
    }
  }
  p.aiTarget = target
  walkTo(p, target, dist(p.pos, target) > 6)
  p.faceTarget = dist(p.pos, target) < 3 ? state.ball.pos : null
}
