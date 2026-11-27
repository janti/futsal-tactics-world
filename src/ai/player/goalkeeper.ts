/** Goalkeeper positioning, saves movement, claiming and distribution. */
import { attr, clamp } from '../../core/math/scalar'
import type { SeededRandom } from '../../core/random/SeededRandom'
import { addScaled, closestOnSegment, dist, len, normalize, sub, type Vec2 } from '../../core/math/vec2'
import { estimateTimeToReach } from '../../physics/PlayerPhysics'
import { laneOpenness, predictPassTarget, pressureOn } from '../../physics/PassingPhysics'
import { rollingLaunchSpeed } from '../../physics/BallPhysics'
import type { MatchState, PlayerState } from '../../simulation/MatchState'
import { BALL, COURT, PASS, PLAYER, POST_X, SCREEN, THROW } from '../../simulation/SimulationConfig'
import type { AIActions } from '../common'
import { walkTo } from '../movement'
import { TWO_V_ONE, twoVersusOne } from '../team/defending'
import { interceptPoint, passInterceptable } from '../passing'

/** Keeper coming off his line against a free shooting chance (metres off the line). */
export const KEEPER_OUT = { base: 0.9, perMetre: 0.22, max: 2.8 } as const

/**
 * A free shooting chance for `shooter` at the goal `goal`: inside 13 m (and not right on top of the
 * keeper), not under pressure and no outfield defender in the way to goal.
 */
export function freeShootingChance(state: MatchState, shooter: PlayerState, goal: Vec2): boolean {
  const d = dist(shooter.pos, goal)
  if (d > 13 || d < 3.5 || Math.abs(shooter.pos.x) > 7.5) return false
  if (pressureOn(state, shooter) > 0.3) return false
  for (const o of state.players) {
    if (o.team === shooter.team || o.role === 'GK') continue
    const { point } = closestOnSegment(shooter.pos, goal, o.pos)
    if (dist(point, o.pos) < 1.6) return false
  }
  return true
}

/** Seconds (of the four) a keeper with the ball in his hands waits while every throw is risky. */
export const KEEPER_WAIT_FOR_OPTION = 2.5

export function goalkeeperBehaviour(
  state: MatchState,
  p: PlayerState,
  actions: AIActions,
  rng: SeededRandom,
  dt: number,
  decide: boolean,
): void {
  const dir = state.teams[p.team].attackDir
  const goalLineY = -dir * COURT.halfLength
  const goal = { x: 0, y: goalLineY }
  const ball = state.ball
  // Watch the ball — but never turn his back on the court for a ball behind him (in the net, past
  // the line): he keeps facing out.
  p.faceTarget =
    (ball.pos.y - p.pos.y) * dir > -0.3 ? ball.pos : { x: ball.pos.x * 0.5, y: p.pos.y + dir * 6 }

  if (ball.ownerId === p.id) {
    p.aiState = 'distribute'
    p.aiHoldTimer += dt
    p.moveIntent = { x: 0, y: 0 }
    // With the ball at the feet (back pass) the keeper is an outfield player: release it quickly
    // under pressure. With the ball in the hands there is no rush.
    const pressured = !ball.inHands && pressureOn(state, p) > 0.35
    const holdTime = ball.inHands ? 0.9 : pressured ? 0.25 : 0.6
    if (decide && p.aiHoldTimer > holdTime) {
      let best: PlayerState | null = null
      let bestScore = -Infinity
      let bestRisky = false
      for (const t of state.players) {
        if (t.team !== p.team || t.id === p.id) continue
        const open = clamp(laneOpenness(state, p.team, p.pos, t.pos), 0, 3)
        // Never throw or pass to a teammate an opponent can cut off: along the floor the ball's path,
        // for an arced throw the place where it comes down (he must get there first).
        const groundCut = passInterceptable(state, p.team, p.pos, t.pos)
        const arced = ball.inHands && (dist(t.pos, p.pos) > 8.5 || groundCut)
        const risky = (arced ? lobContested(state, p, t) : groundCut) ? -3 : 0
        // A short ball to a teammate about to be pressed near our goal is a gift: prefer one with time.
        let pressed = 0
        if (dist(t.pos, goal) < 13)
          for (const o of state.players)
            if (o.team !== p.team && dist(o.pos, t.pos) < (o.id === state.controlledId ? 5 : 4))
              pressed = -1.5
        const score = open + risky + pressed + rng.range(0, 0.4) - dist(t.pos, p.pos) / 20
        if (score > bestScore) {
          bestScore = score
          best = t
          bestRisky = risky < 0
        }
      }
      // Ball in the hands and every throw one an opponent can cut out (teammates still recovering, e.g.
      // after a rotation up the court): wait for somebody to get free — well within the four seconds.
      if (ball.inHands && bestRisky && ball.handsTimer < KEEPER_WAIT_FOR_OPTION) return
      // A throw beyond a few metres, or one an opponent could cut out along the floor, goes in an arc.
      const lob =
        best !== null &&
        ball.inHands &&
        (dist(best.pos, p.pos) > 8.5 || passInterceptable(state, p.team, p.pos, best.pos))
      if (best && lob) {
        actions.lobThrow(p, best, lobApex(dist(best.pos, p.pos)))
      } else if (best && ball.inHands) {
        // From the hands: the same controlled throw a human keeper makes (aim at where the receiver
        // will be; bowl short throws, throw long ones overarm).
        const target = predictPassTarget(p, best, false, state.teams[p.team].attackDir)
        const d = dist(target, p.pos)
        const wanted = clamp(rollingLaunchSpeed(d, PASS.arrivalSpeed), THROW.minSpeed, THROW.maxSpeed[1])
        const maxSpeed = attr(p.profile.attributes.throwing, THROW.maxSpeed[0], THROW.maxSpeed[1])
        const power = clamp((wanted - THROW.minSpeed) / (maxSpeed - THROW.minSpeed), 0.15, 1)
        actions.throwBall(p, sub(target, p.pos), power)
      } else if (best && bestScore < -1) {
        // At his feet with every short ball one an opponent can cut out: dink it over the presser
        // towards the furthest teammate rather than give it away in front of goal.
        let far = best
        for (const t of state.players)
          if (t.team === p.team && t.id !== p.id && dist(t.pos, p.pos) > dist(far.pos, p.pos)) far = t
        actions.chip(p, sub(far.pos, p.pos), 1)
      } else if (best) {
        // Ball at the feet (back pass): played like an outfield player.
        actions.pass(p, sub(best.pos, p.pos), false, best)
      }
    }
    return
  }

  // A teammate's pass to the keeper: come to meet it like an outfield player instead of waiting on
  // the line. Sprint when an opponent could get there first, otherwise move up at running pace.
  if (ball.mode === 'free' && ball.intendedReceiverId === p.id && ball.keeperRetouchId !== p.id) {
    p.aiState = 'receive'
    let meet = interceptPoint(state, p)
    // Never further than the halfway line.
    if (dir * meet.y > -0.5) meet = { x: meet.x, y: -dir * 0.5 }
    const myT = estimateTimeToReach(p, meet)
    let oppT = Infinity
    for (const o of state.players) if (o.team !== p.team) oppT = Math.min(oppT, estimateTimeToReach(o, meet))
    walkTo(p, meet, oppT < myT + 0.8 || dist(meet, p.pos) > 4)
    p.faceTarget = ball.pos
    return
  }

  // Shot or fast ball heading at goal: get across into its path at the keeper's current depth.
  // Reaction delay: the keeper only starts to move across once he has read the shot.
  const reaction = attr(
    p.profile.attributes.reflexes,
    PLAYER.goalkeeperReaction[0],
    PLAYER.goalkeeperReaction[1],
  )
  // A screened shot is seen late.
  const screenDelay = ball.isShot ? ball.shotScreen * SCREEN.reactionDelay : 0
  // Lab drill: the practice keeper reacts a little later and stays on his line (below).
  const practice = state.drill && p.id !== state.controlledId
  const reacted = state.time - ball.kickTime >= reaction + screenDelay + (practice ? 0.15 : 0)
  const threat =
    ball.mode === 'free' && ball.lastTouchTeam !== p.team && reacted
      ? predictGoalThreat(ball, goalLineY, p)
      : null
  // (The practice keeper is set when the shot is struck: he does not walk across with the ball.)
  if (practice && ball.isShot && ball.mode === 'free' && ball.lastTouchTeam !== p.team) {
    p.aiState = 'position' // (standing: no diving reach)
    p.moveIntent = { x: 0, y: 0 }
    return
  }
  if (threat) {
    p.aiState = 'save'
    walkTo(p, threat, true)
    return
  }

  // Claim loose balls in the penalty area when the keeper gets there first (unless the
  // second-possession rule forbids him to play it again).
  if (
    ball.mode === 'free' &&
    ball.keeperRetouchId !== p.id &&
    dist(ball.pos, goal) < COURT.penaltyAreaRadius + 0.5
  ) {
    const myT = estimateTimeToReach(p, ball.pos)
    let oppT = Infinity
    for (const o of state.players)
      if (o.team !== p.team) oppT = Math.min(oppT, estimateTimeToReach(o, ball.pos))
    if (myT < oppT - 0.1) {
      p.aiState = 'claim'
      walkTo(p, interceptPoint(state, p), true)
      p.faceTarget = null
      return
    }
  }

  // 2 v 1 at the arc: our defender takes the second attacker, so the keeper comes out (up to the
  // edge of the area) on the line to the ball to block the shot.
  const twoV1 = twoVersusOne(state, p.team)
  if (
    !practice &&
    twoV1 &&
    twoV1.carrierToGoal <= TWO_V_ONE.markDistance &&
    ball.ownerId === twoV1.carrier.id
  ) {
    p.aiState = 'position'
    const n = normalize(sub(twoV1.carrier.pos, goal))
    const out = Math.min(COURT.penaltyAreaRadius - 0.3, twoV1.carrierToGoal - 1.6)
    walkTo(p, addScaled(goal, n, Math.max(1, out)), true)
    return
  }

  // The practice keeper (Lab drill) stands on his line, near the middle, following the ball a little.
  if (practice && ball.lastTouchTeam !== p.team) {
    p.aiState = 'position'
    walkTo(p, { x: clamp(ball.pos.x * 0.12, -0.4, 0.4), y: goalLineY + dir * 0.4 }, false)
    return
  }

  // Angle positioning: on the bisector of the angle the ball sees between the posts (on an angled
  // ball this is towards the near post, so the near post is covered), a little off the line.
  p.aiState = 'position'
  const toBall = sub(ball.pos, goal)
  const db = len(toBall)
  let depth = clamp(0.5 + db * 0.07, 0.6, 2.2)
  // A free shooting chance (carrier unpressed, nobody in the way, inside 13 m): come off the line to
  // narrow the angle — measured, never closer than 2.6 m to the shooter, walking rather than rushing,
  // so a well-placed shot can still beat him.
  const shooter = ball.ownerId !== null ? state.players[ball.ownerId]! : null
  let narrowing = false
  if (
    shooter &&
    shooter.team !== p.team &&
    shooter.role !== 'GK' &&
    !ball.inHands &&
    !practice &&
    freeShootingChance(state, shooter, goal)
  ) {
    const out = Math.min(
      clamp(KEEPER_OUT.base + (13 - db) * KEEPER_OUT.perMetre, 1.2, KEEPER_OUT.max),
      db - 2.6,
    )
    if (out > depth) {
      depth = out
      narrowing = true
    }
  }
  const n = db > 1e-3 ? normalize(toBall) : { x: 0, y: dir }
  const depthY = Math.max(0.35, Math.abs(n.y * depth))
  let tx = goal.x + n.x * depth
  const u1 = normalize(sub({ x: POST_X, y: goalLineY }, ball.pos))
  const u2 = normalize(sub({ x: -POST_X, y: goalLineY }, ball.pos))
  const bis = normalize({ x: u1.x + u2.x, y: u1.y + u2.y })
  const planeY = goalLineY + dir * depthY
  if (Math.abs(bis.y) > 0.05) {
    const t = (planeY - ball.pos.y) / bis.y
    if (t > 0) tx = ball.pos.x + bis.x * t
  }
  const target = { x: clamp(tx, -(POST_X - 0.3), POST_X - 0.3), y: planeY }
  walkTo(p, target, dist(target, p.pos) > (narrowing ? 2.5 : 1.2))
}

/**
 * Predict whether a free ball will cross the goal line inside (or just outside) the goal mouth.
 * Returns the point on the ball's path where the keeper should be: at the keeper's current depth
 * (0.4..1.6 m off the line) so he steps across the line of the shot instead of retreating.
 */
function predictGoalThreat(ball: MatchState['ball'], goalLineY: number, gk: PlayerState): Vec2 | null {
  const dirToGoal = Math.sign(goalLineY)
  if (ball.vel.y * dirToGoal < 3) return null
  const depth = clamp(Math.abs(goalLineY - gk.pos.y), 0.4, 1.6)
  const planeY = goalLineY - dirToGoal * depth
  // Sample the rolling/flying ball forward (simple deceleration model, 3 s horizon).
  let x = ball.pos.x
  let y = ball.pos.y
  let vx = ball.vel.x
  let vy = ball.vel.y
  const h = 0.02
  let atPlane: Vec2 | null = null
  for (let t = 0; t < 3; t += h) {
    const sp = Math.hypot(vx, vy)
    if (sp < 0.5) return null
    const ns = Math.max(0, sp - 1.9 * h)
    vx = (vx / sp) * ns
    vy = (vy / sp) * ns
    x += vx * h
    y += vy * h
    if (!atPlane && (y - planeY) * dirToGoal >= 0) atPlane = { x, y: planeY }
    if ((y - goalLineY) * dirToGoal >= 0) {
      if (Math.abs(x) > COURT.goalHalfWidth + 0.6) return null
      const target = atPlane ?? { x, y: planeY }
      return { x: clamp(target.x, -1.7, 1.7), y: target.y }
    }
  }
  return null
}

/** Apex height (m) of the keeper's arced throw over `d` metres. */
function lobApex(d: number): number {
  return clamp(2 + d * 0.12, 2.4, 4.2)
}

/**
 * An arced throw to `t` is contested when an opponent can get to where it comes down by the time it
 * gets there: the ball is in the air for a second or more, so a receiver already on the spot has to
 * wait for it — an opponent arriving as it drops (the human player sprints in) takes it off him.
 */
function lobContested(state: MatchState, keeper: PlayerState, t: PlayerState): boolean {
  // Where it comes down: short of where the receiver will be (as lobThrow aims it).
  const aim = addScaled(t.pos, t.vel, 0.5)
  const landing = {
    x: keeper.pos.x + (aim.x - keeper.pos.x) * 0.85,
    y: keeper.pos.y + (aim.y - keeper.pos.y) * 0.85,
  }
  const apex = lobApex(dist(aim, keeper.pos))
  const g = BALL.gravity
  const flight = Math.sqrt((2 * Math.max(0.1, apex - THROW.releaseHeight)) / g) + Math.sqrt((2 * apex) / g)
  // The ball is his once it has come down and he has it under control.
  const mine = Math.max(estimateTimeToReach(t, landing), flight) + 0.25
  for (const o of state.players) {
    if (o.team === keeper.team || o.role === 'GK') continue
    const human = o.id === state.controlledId
    const theirs = estimateTimeToReach(o, landing) * (human ? 0.85 : 1)
    if (theirs < mine + (human ? 0.2 : -0.1)) return true
  }
  return false
}
