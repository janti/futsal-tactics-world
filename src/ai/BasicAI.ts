/**
 * Team AI update (per tick). The behaviour lives in layers (see AI_DESIGN.md): team phases, ball
 * winner and cover defender per team, then each player's behaviour — restarts, goalkeeper, ball
 * carrier (utility-scored options) or off-ball (press, cover, support, runs). Decisions run at about
 * 10 Hz (difficulty-dependent), staggered by player; steering runs every tick. Everything is
 * re-exported here so callers and tests can import from one place.
 */
import { updatePressTriggers } from './team/pressing'
import type { SeededRandom } from '../core/random/SeededRandom'
import { dist, len } from '../core/math/vec2'
import type { MatchState, PlayerState } from '../simulation/MatchState'
import { type AIActions, difficultyFor, kickoffAnchor } from './common'
import { steer, walkTo } from './movement'
import { pickBallWinner, updateDefensiveTransitions, pickHelper } from './team/defending'
import { receivePoint } from './passing'
import { carrierBehaviour } from './player/carrier'
import { goalkeeperBehaviour } from './player/goalkeeper'
import { offBallDecision } from './player/offBall'
import { restartBehaviour } from './restarts'
import { updateTeamPhases } from './team/phases'
export * from './common'
export * from './movement'
export * from './team/defending'
export * from './team/attacking'
export * from './passing'
export * from './player/carrier'
export * from './player/goalkeeper'
export * from './player/offBall'
export * from './restarts'
export * from './team/phases'
export * from './team/pressing'
export * from './team/roles'
export * from './spatial/PitchControl'

export function updateAI(state: MatchState, actions: AIActions, rng: SeededRandom, dt: number): void {
  updateDefensiveTransitions(state)
  updateTeamPhases(state)
  updatePressTriggers(state)
  const chasers: [number | null, number | null] = [pickBallWinner(state, 0), pickBallWinner(state, 1)]
  const helpers: [number | null, number | null] = [
    pickHelper(state, 0, chasers[0]),
    pickHelper(state, 1, chasers[1]),
  ]
  for (const p of state.players) {
    p.aiSetPieceTimer = Math.max(0, p.aiSetPieceTimer - dt)
    p.aiRunTimer = Math.max(0, p.aiRunTimer - dt)
    p.aiRunCooldown = Math.max(0, p.aiRunCooldown - dt)
    p.aiRecoverTimer = Math.max(0, p.aiRecoverTimer - dt)
    if (p.id === state.controlledId) continue
    p.aiDecisionTimer -= dt
    const decide = p.aiDecisionTimer <= 0
    if (decide) p.aiDecisionTimer += difficultyFor(state, p.team).decisionInterval
    p.faceTarget = null
    p.sole = false

    if (state.phase === 'halftime' || state.phase === 'fulltime') {
      p.aiState = 'break'
      p.moveIntent = { x: 0, y: 0 }
      continue
    }
    if (state.phase === 'goal') {
      // Back to the kick-off positions straight away (hurrying when far, e.g. from the other half).
      p.aiState = 'celebrate'
      const spot = kickoffAnchor(state, p)
      walkTo(p, spot, dist(p.pos, spot) > 6)
      // A keeper who has just conceded turns back to face the court (not the ball in his net).
      if (p.role === 'GK') p.faceTarget = { x: 0, y: 0 }
      continue
    }
    if (state.phase === 'restart') {
      p.aiState = 'restart'
      restartBehaviour(state, p, actions, rng, dt)
      continue
    }
    if (p.role === 'GK') {
      goalkeeperBehaviour(state, p, actions, rng, dt, decide)
      continue
    }
    if (state.ball.ownerId === p.id) {
      carrierBehaviour(state, p, actions, rng, dt, decide)
      continue
    }
    // Ball-winner role changes take effect immediately so two players never chase together.
    const isWinner = chasers[p.team] === p.id || helpers[p.team] === p.id
    const staleChase = (p.aiState === 'chase' || p.aiState === 'press') !== isWinner
    if (decide || staleChase || p.aiState === '' || p.aiState === 'carry')
      offBallDecision(state, p, chasers[p.team], helpers[p.team])
    steer(state, p)
  }
}

/**
 * Human-controlled player assistance: a pass coming to him is met automatically. Control switches to
 * the receiver the moment the ball is played, while the passer's direction key is usually still
 * held — without this he would run off along that key, away from the ball, and an opponent would
 * step in. He goes to meet it (sprinting when it is far) until he has it.
 */
export function assistControlledPlayer(state: MatchState, p: PlayerState): void {
  const ball = state.ball
  if (
    ball.mode === 'free' &&
    ball.intendedReceiverId === p.id &&
    len(ball.vel) > 1.5 &&
    (ball.z < 1.2 || ball.landing !== null)
  ) {
    const meet = receivePoint(state, p)
    walkTo(p, meet, dist(meet, p.pos) > 2.5)
    p.faceTarget = ball.pos
  }
}
