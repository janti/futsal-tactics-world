/** Off-ball decisions: press, chase, cover, support or attacking runs. */
import { addScaled, dist, normalize, sub } from '../../core/math/vec2'
import type { MatchState, PlayerState } from '../../simulation/MatchState'
import { COURT } from '../../simulation/SimulationConfig'
import { dynamicAnchor } from '../positioning/Formation'
import { attackingRole } from '../team/roles'
import { PRESS_ENGAGE_DISTANCE } from '../common'
import { markingPosition, twoVersusOne, twoVersusOneSpot } from '../team/defending'
import { runInBehind, followUpTarget, backPostSpot, pivotAnchor, supportPosition } from '../team/attacking'
import { interceptPoint, passInterception } from '../passing'

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
      p.aiTarget = interceptPoint(state, p)
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
