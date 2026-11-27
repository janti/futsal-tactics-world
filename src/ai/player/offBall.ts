/** Off-ball decisions: press, chase, cover, support or attacking runs. */
import { addScaled, dist, normalize, sub } from '../../core/math/vec2'
import type { MatchState, PlayerState } from '../../simulation/MatchState'
import { COURT } from '../../simulation/SimulationConfig'
import { dynamicAnchor } from '../positioning/Formation'
import { attackingRole, defensiveRole } from '../team/roles'
import { KEEPER_BALL_ALA_DROP, pressEngageDistance } from '../common'
import { pressTriggerActive } from '../team/pressing'
import {
  carrierBackToGoal,
  markingPosition,
  opponentPivot,
  twoVersusOne,
  twoVersusOneSpot,
} from '../team/defending'
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
import { isBreakaway, twoOnKeeperMate, twoOnKeeperSpot } from './carrier'

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
    const trig = state.pressTrigger[p.team]
    if (trig?.kind === 'touchline' && pressTriggerActive(state, p.team)) {
      // The trap by the touch line: the second man shuts the way (and the pass) along the line, the
      // first one the way inside — the line does the rest.
      const oppDir = state.teams[owner.team].attackDir
      p.aiTarget = { x: owner.pos.x - Math.sign(owner.pos.x) * 0.5, y: owner.pos.y + oppDir * 1.7 }
    }
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
      if (defensiveRole(state, p) === 'PIVOT' && carrierBackToGoal(state, owner)) {
        // Back-to-goal carrier: the pivot presses on the side he faces, closing the pass back.
        p.aiTarget = addScaled(owner.pos, { x: Math.cos(owner.facing), y: Math.sin(owner.facing) }, 1.1)
        return
      }
      if (dist(owner.pos, ownGoal) > pressEngageDistance(state, p.team)) {
        // A low block stands off further (it waits for the carrier to come to it).
        const standOff = state.teams[p.team].tactics.pressing === 'low' ? 4.5 : 3
        const off = addScaled(owner.pos, toGoal, standOff)
        p.aiTarget = { x: off.x * 0.75, y: off.y }
        // Cover shadow: come at him from the side of their pivot, so the body blocks the pass into
        // the pivot (blended with the goal-side spot: the way to goal stays covered too).
        const pivot = opponentPivot(state, p.team, owner)
        if (pivot) {
          const shadow = addScaled(owner.pos, normalize(sub(pivot.pos, owner.pos)), standOff * 0.85)
          p.aiTarget = { x: (p.aiTarget.x + shadow.x * 4) / 5, y: (p.aiTarget.y + shadow.y * 4) / 5 }
        }
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
  const role = inPossession ? attackingRole(state, p) : defensiveRole(state, p)
  const tactics = state.teams[p.team].tactics
  let anchor = dynamicAnchor(role, inPossession ? 'attack' : 'defend', dir, ball.pos, tactics.formation)
  // The roaming pivot belongs to the 3-1 (in the 4-0 the "pivot" is one of the flat four).
  if (inPossession && role === 'PIVOT' && tactics.formation === '3-1') anchor = pivotAnchor(state, p, anchor)
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
    // Two on the keeper: the second man runs level, then to the back post for the tap-in.
    if (owner && owner.team === p.team && isBreakaway(state, owner, { x: 0, y: dir * COURT.halfLength })) {
      const mate = twoOnKeeperMate(state, owner)
      if (mate?.id === p.id) {
        p.aiState = 'run'
        p.aiTarget = twoOnKeeperSpot(state, owner, p)
        p.aiSetPieceTimer = Math.max(p.aiSetPieceTimer, 1.5)
        return
      }
    }
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
      p.aiTarget = help.spot
      p.aiSetPieceTimer = 1.2 // a ball laid back or loose at the far post is struck first time
      // The deep run down the wing carries on even once he is past the pivot.
      if (help.kind === 'deep') {
        p.aiRunTarget = help.spot
        p.aiRunTimer = 2.2
        p.aiRunCooldown = 7
      }
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
    if (backPost) {
      // Attack the back post (sprinting) and strike a ball across first time.
      p.aiState = 'run'
      p.aiTarget = backPost
      p.aiSetPieceTimer = Math.max(p.aiSetPieceTimer, 1.3)
      return
    }
    p.aiState = 'support'
    p.aiTarget = supportPosition(state, p, anchor)
  } else {
    p.aiState = 'cover'
    p.aiTarget = markingPosition(state, p, [winnerId, helperId])
  }
}
