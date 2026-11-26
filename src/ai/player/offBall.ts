/** Off-ball decisions: press, chase, cover, support or attacking runs. */
import { addScaled, dist, normalize, sub } from '../../core/math/vec2'
import type { MatchState, PlayerState } from '../../simulation/MatchState'
import { COURT } from '../../simulation/SimulationConfig'
import { dynamicAnchor } from '../positioning/Formation'
import { attackingRole } from '../team/roles'
import { KEEPER_BALL_ALA_DROP, PRESS_ENGAGE_DISTANCE } from '../common'
import { carrierBackToGoal, markingPosition, twoVersusOne, twoVersusOneSpot } from '../team/defending'
import {
  runInBehind,
  followUpTarget,
  backPostSpot,
  pivotAnchor,
  pivotSupportSpot,
  squareOptionSpot,
  supportPosition,
} from '../team/attacking'
import { interceptPoint, passInterception, receivePoint } from '../passing'

export function offBallDecision(
  state: MatchState,
  p: PlayerState,
  winnerId: number | null,
  helperId: number | null,
): void {
  const ball = state.ball
  const dir = state.teams[p.team].attackDir
  const owner = ball.ownerId !== null ? state.players[ball.ownerId]! : null
  const twoV1 = twoVersusOne(state, p.team)
  if (twoV1 && twoV1.defender.id === p.id) {
    p.aiState = 'twoVone'
    p.aiTarget = twoVersusOneSpot(state, twoV1)
    return
  }
  if (helperId === p.id && owner) {
    // Cover defender: the carrier got past the first defender (or nobody is goal-side of him) near
    // goal; the next defender steps across to close him down.
    p.aiState = 'press'
    const ownGoal = { x: 0, y: -dir * COURT.halfLength }
    p.aiTarget = addScaled(owner.pos, normalize(sub(ownGoal, owner.pos)), 0.9)
    return
  }
  if (winnerId === p.id) {
    if (ball.mode === 'free') {
      p.aiState = 'chase'
      // A pass to him: meet it (stepping on towards it); a loose ball: the quickest point to win it.
      p.aiTarget = ball.intendedReceiverId === p.id ? receivePoint(state, p) : interceptPoint(state, p)
    } else if (owner && owner.role === 'GK') {
      // A keeper playing with his feet (he may not pick it up): go straight for the ball to win it.
      p.aiState = 'chase'
      p.aiTarget = { ...ball.pos }
    } else if (owner) {
      // Press goal-side of the carrier. Far from our goal the press is measured: stand off about 3 m,
      // on the inside, closing the way through the middle instead of diving in high up the court.
      p.aiState = 'press'
      const ownGoal = { x: 0, y: -dir * COURT.halfLength }
      const toGoal = normalize(sub(ownGoal, owner.pos))
      if (p.role === 'PIVOT' && carrierBackToGoal(state, owner)) {
        // Back-to-goal carrier: the pivot presses on the side he faces, closing the pass back.
        p.aiTarget = addScaled(owner.pos, { x: Math.cos(owner.facing), y: Math.sin(owner.facing) }, 1.1)
        return
      }
      if (dist(owner.pos, ownGoal) > PRESS_ENGAGE_DISTANCE) {
        const off = addScaled(owner.pos, toGoal, 3)
        p.aiTarget = { x: off.x * 0.75, y: off.y }
      } else p.aiTarget = addScaled(owner.pos, toGoal, 0.7)
    }
    return
  }
  const inPossession = state.possessionTeam === p.team
  // Read an opponent's pass: step into its path if he can get there before the ball reaches the
  // receiver.
  const cut = passInterception(state, p)
  if (cut) {
    p.aiState = 'intercept'
    p.aiTarget = cut
    return
  }
  // In attack the role comes from the dynamic assignment (players fill the shape from where they are).
  const role = inPossession ? attackingRole(state, p) : p.role
  let anchor = dynamicAnchor(role, inPossession ? 'attack' : 'defend', dir, ball.pos)
  if (inPossession && role === 'PIVOT') anchor = pivotAnchor(state, p, anchor)
  // Our keeper on the ball: the alas come deeper so the ball out to the wing is easy — the full drop
  // for a human keeper (he needs a fixed, easy target); the AI keeper picks the safe option himself.
  if (
    inPossession &&
    owner?.team === p.team &&
    owner.role === 'GK' &&
    (role === 'ALA_L' || role === 'ALA_R')
  ) {
    const drop = p.team === state.humanTeam ? KEEPER_BALL_ALA_DROP : KEEPER_BALL_ALA_DROP * 0.5
    anchor = { x: anchor.x, y: anchor.y - dir * drop }
  }
  if (inPossession) {
    // Attacking movement first: follow up our shot at the back post, keep running a run in behind,
    // start a new one into empty space, or take the back post when the ball is on a wing near goal.
    const follow = followUpTarget(state, p)
    if (follow) {
      p.aiState = 'run'
      p.aiTarget = follow
      p.aiSetPieceTimer = 1.5 // a rebound or loose ball he gets is struck at once (tap-in)
      return
    }
    if (p.aiRunTimer > 0 && owner && owner.team === p.team) {
      p.aiState = 'run'
      p.aiTarget = p.aiRunTarget
      return
    }
    // Our deepest player on the ball turning to one side: the ala there drops level for a square pass.
    const square = squareOptionSpot(state, p)
    if (square) {
      p.aiState = 'support'
      p.aiTarget = square
      return
    }
    // Our pivot has it up the court: help him (lay-off spot, far post).
    const help = pivotSupportSpot(state, p)
    if (help) {
      p.aiState = 'run'
      p.aiTarget = help
      p.aiSetPieceTimer = 1.2 // a ball laid back or loose at the far post is struck first time
      return
    }
    const behind = runInBehind(state, p)
    if (behind) {
      p.aiState = 'run'
      p.aiRunTarget = behind
      p.aiRunTimer = 2.4
      p.aiRunCooldown = 9
      p.aiTarget = behind
      return
    }
    const backPost = backPostSpot(state, p)
    p.aiState = 'support'
    p.aiTarget = backPost ?? supportPosition(state, p, anchor)
  } else {
    p.aiState = 'cover'
    p.aiTarget = markingPosition(state, p, [winnerId, helperId])
  }
}
