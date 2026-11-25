/**
 * Basic team AI (Milestone 1/2 groundwork). Deliberately simple but structured around the futsal
 * principles that the full Utility AI will build on:
 *  - one primary ball winner per team (anti-ball-chasing), everyone else holds a ball-oriented shape,
 *  - the intended pass receiver moves to meet the ball,
 *  - the carrier dribbles towards goal, shoots in range, otherwise passes to the most open teammate,
 *  - goalkeepers position on the ball-goal line and react to shots.
 * Decisions run at 10 Hz, staggered by player id; steering runs every tick.
 */
import { attr, clamp } from '../core/math/scalar'
import type { SeededRandom } from '../core/random/SeededRandom'
import { addScaled, closestOnSegment, dist, len, normalize, sub, type Vec2 } from '../core/math/vec2'
import { estimateTimeToReach, routeAroundGoals } from '../physics/PlayerPhysics'
import { laneOpenness, predictPassTarget, pressureOn } from '../physics/PassingPhysics'
import { rollingLaunchSpeed } from '../physics/BallPhysics'
import type { MatchState, PlayerState, TeamId } from '../simulation/MatchState'
import { COURT, PASS, PLAYER, RESTART, SCREEN, THROW } from '../simulation/SimulationConfig'
import { baseAnchor, dynamicAnchor } from './positioning/Formation'
import { clampRestartAim, restartTakerSpot } from '../simulation/RestartGeometry'

export interface AIActions {
  pass(p: PlayerState, dir: Vec2, through: boolean, receiver: PlayerState | null): void
  shoot(p: PlayerState, dir: Vec2, power: number): void
  /** Goalkeeper throw from the hands (same throw a human keeper makes). */
  throwBall(p: PlayerState, dir: Vec2, power: number): void
}

const DECISION_INTERVAL = 0.1

export function updateAI(state: MatchState, actions: AIActions, rng: SeededRandom, dt: number): void {
  const chasers: [number | null, number | null] = [pickBallWinner(state, 0), pickBallWinner(state, 1)]
  for (const p of state.players) {
    if (p.id === state.controlledId) continue
    p.aiDecisionTimer -= dt
    const decide = p.aiDecisionTimer <= 0
    if (decide) p.aiDecisionTimer += DECISION_INTERVAL
    p.faceTarget = null
    p.sole = false

    if (state.phase === 'halftime' || state.phase === 'fulltime') {
      p.aiState = 'break'
      p.moveIntent = { x: 0, y: 0 }
      continue
    }
    if (state.phase === 'goal') {
      p.aiState = 'celebrate'
      walkTo(p, kickoffAnchor(state, p), false)
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
    const isWinner = chasers[p.team] === p.id
    const staleChase = (p.aiState === 'chase' || p.aiState === 'press') !== isWinner
    if (decide || staleChase || p.aiState === '' || p.aiState === 'carry')
      offBallDecision(state, p, chasers[p.team])
    steer(state, p)
  }
}

/** Human-controlled player assistance: when idle and a pass is coming, move to meet it. */
export function assistControlledPlayer(state: MatchState, p: PlayerState): void {
  const ball = state.ball
  if (ball.mode === 'free' && ball.intendedReceiverId === p.id && len(p.moveIntent) < 0.1) {
    const meet = interceptPoint(state, p)
    walkTo(p, meet, dist(meet, p.pos) > 3)
  }
}

function kickoffAnchor(state: MatchState, p: PlayerState): Vec2 {
  const own = state.restart?.type === 'kickoff' ? state.restart.team === p.team : false
  return baseAnchor(p.role, own ? 'kickoffOwn' : 'kickoffOpp', state.teams[p.team].attackDir)
}

function restartBehaviour(
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
      const best = bestPassOption(state, p, rng)
      if (best) {
        // Aim at the receiver: the taker steps round the ball to stand behind it on that line.
        r.aimDir = clampRestartAim(state, r, sub(best.player.pos, r.spot))
        p.faceTarget = best.player.pos
      }
      const wait = r.type === 'kickoff' ? 0.5 : 0.9
      if (best && p.aiHoldTimer >= wait) actions.pass(p, r.aimDir, false, best.player)
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
    target = dynamicAnchor(p.role, mode, state.teams[p.team].attackDir, r.spot)
    if (r.team !== p.team) target = keepDistance(target, r.spot, RESTART.opponentDistance + 0.3)
  }
  walkTo(p, target, dist(p.pos, target) > 6)
  p.faceTarget = state.ball.pos
}

function keepDistance(target: Vec2, from: Vec2, minDist: number): Vec2 {
  const d = dist(target, from)
  if (d >= minDist) return target
  const away = d > 1e-3 ? normalize(sub(target, from)) : { x: 0, y: 1 }
  return addScaled(from, away, minDist)
}

/**
 * Anti-ball-chasing: at most one player per team goes for the ball (loose ball or pressing the
 * carrier). On the human team the AI only takes this role when the human player is clearly slower.
 */
function pickBallWinner(state: MatchState, team: TeamId): number | null {
  const ball = state.ball
  if (state.phase !== 'play') return null
  const owner = ball.ownerId !== null ? state.players[ball.ownerId]! : null
  if (owner && owner.team === team) return null
  // Nobody presses a keeper holding the ball in their hands; the team drops into shape instead.
  if (owner && ball.inHands) return null
  if (ball.mode === 'free' && ball.intendedReceiverId !== null) {
    const recv = state.players[ball.intendedReceiverId]!
    if (recv.team === team) return recv.id
  }
  const target = owner ? owner.pos : addScaled(ball.pos, ball.vel, 0.35)
  let best: PlayerState | null = null
  let bestT = Infinity
  let humanT = Infinity
  for (const p of state.players) {
    if (p.team !== team || p.role === 'GK') continue
    const t = estimateTimeToReach(p, target)
    if (p.id === state.controlledId) {
      humanT = t
      continue
    }
    if (t < bestT) {
      bestT = t
      best = p
    }
  }
  if (!best) return null
  if (state.humanTeam === team && state.controlledId !== null && !(bestT < humanT - 0.7)) return null
  return best.id
}

function offBallDecision(state: MatchState, p: PlayerState, winnerId: number | null): void {
  const ball = state.ball
  const dir = state.teams[p.team].attackDir
  const owner = ball.ownerId !== null ? state.players[ball.ownerId]! : null
  if (winnerId === p.id) {
    if (ball.mode === 'free') {
      p.aiState = 'chase'
      p.aiTarget = interceptPoint(state, p)
    } else if (owner && owner.role === 'GK') {
      // A keeper playing with his feet (he may not pick it up): go straight for the ball to win it.
      p.aiState = 'chase'
      p.aiTarget = { ...ball.pos }
    } else if (owner) {
      // Press goal-side of the carrier.
      p.aiState = 'press'
      const ownGoal = { x: 0, y: -dir * COURT.halfLength }
      p.aiTarget = addScaled(owner.pos, normalize(sub(ownGoal, owner.pos)), 0.7)
    }
    return
  }
  const inPossession = state.possessionTeam === p.team
  const anchor = dynamicAnchor(p.role, inPossession ? 'attack' : 'defend', dir, ball.pos)
  if (inPossession) {
    p.aiState = 'support'
    p.aiTarget = supportPosition(state, p, anchor)
  } else {
    p.aiState = 'cover'
    p.aiTarget = coverPosition(state, p, anchor)
  }
}

/** Move off the anchor towards a spot with an open passing lane to the ball. */
function supportPosition(state: MatchState, p: PlayerState, anchor: Vec2): Vec2 {
  const ballPos = state.ball.pos
  let best = anchor
  let bestScore = -Infinity
  const offsets: Vec2[] = [
    { x: 0, y: 0 },
    { x: 1.5, y: 0 },
    { x: -1.5, y: 0 },
    { x: 0, y: 1.5 },
    { x: 0, y: -1.5 },
  ]
  for (const o of offsets) {
    const c = { x: clamp(anchor.x + o.x, -9.3, 9.3), y: clamp(anchor.y + o.y, -19, 19) }
    const lane = clamp(laneOpenness(state, p.team, ballPos, c), 0, 3)
    const d = dist(c, ballPos)
    const spacing = d < 3 ? -2 : 0
    const score = lane - dist(c, anchor) * 0.25 + spacing
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  return best
}

/** Goal-side cover: shift the anchor towards the most dangerous nearby opponent. */
function coverPosition(state: MatchState, p: PlayerState, anchor: Vec2): Vec2 {
  const dir = state.teams[p.team].attackDir
  const ownGoal = { x: 0, y: -dir * COURT.halfLength }
  let threat: PlayerState | null = null
  let bestD = 5
  for (const o of state.players) {
    if (o.team === p.team || o.role === 'GK' || o.id === state.ball.ownerId) continue
    const d = dist(o.pos, anchor)
    if (d < bestD) {
      bestD = d
      threat = o
    }
  }
  if (!threat) return anchor
  const goalSide = addScaled(threat.pos, normalize(sub(ownGoal, threat.pos)), 1.2)
  return { x: anchor.x * 0.5 + goalSide.x * 0.5, y: anchor.y * 0.5 + goalSide.y * 0.5 }
}

/** Earliest point on the ball's path the player can reach (sampled prediction). */
export function interceptPoint(state: MatchState, p: PlayerState): Vec2 {
  const ball = state.ball
  let pos = ball.pos
  let vel = ball.vel
  const h = 0.05
  for (let t = 0; t < 2.5; t += h) {
    if (estimateTimeToReach(p, pos) <= t) return pos
    const s = len(vel)
    if (s < 0.05) break
    const ns = Math.max(0, s - 1.8 * h)
    vel = { x: (vel.x / s) * ns, y: (vel.y / s) * ns }
    pos = addScaled(pos, vel, h)
  }
  return pos
}

function steer(state: MatchState, p: PlayerState): void {
  const d = dist(p.aiTarget, p.pos)
  const urgent = p.aiState === 'chase' || (p.aiState === 'press' && d > 2.5) || d > 5
  walkTo(p, p.aiTarget, urgent)
  if (p.aiState === 'press' && d < 1.5) {
    p.moveIntent = { x: p.moveIntent.x * 0.6, y: p.moveIntent.y * 0.6 }
  }
  if (p.aiState !== 'chase') p.faceTarget = state.ball.pos
}

/** Arrival steering: full intent far away, easing in within 1.5 m, idle inside 0.15 m. */
function walkTo(p: PlayerState, target: Vec2, sprint: boolean): void {
  // Never try to walk through a goal: head for the detour point first.
  const waypoint = routeAroundGoals(p.pos, target)
  if (waypoint !== target) {
    p.moveIntent = normalize(sub(waypoint, p.pos))
    p.sprint = sprint
    return
  }
  const to = sub(target, p.pos)
  const d = len(to)
  if (d < 0.15) {
    p.moveIntent = { x: 0, y: 0 }
    p.sprint = false
    return
  }
  const mag = clamp(d / 1.5, 0, 1)
  const n = normalize(to)
  p.moveIntent = { x: n.x * mag, y: n.y * mag }
  p.sprint = sprint
}

function carrierBehaviour(
  state: MatchState,
  p: PlayerState,
  actions: AIActions,
  rng: SeededRandom,
  dt: number,
  decide: boolean,
): void {
  const dir = state.teams[p.team].attackDir
  const goal = { x: 0, y: dir * COURT.halfLength }
  p.aiHoldTimer += dt
  p.aiState = 'carry'

  // Dribble towards goal, veering away from the nearest opponent.
  let nearest: PlayerState | null = null
  let nd = Infinity
  for (const o of state.players) {
    if (o.team === p.team) continue
    const d = dist(o.pos, p.pos)
    if (d < nd) {
      nd = d
      nearest = o
    }
  }
  let heading = normalize(sub(goal, p.pos))
  const open = spaceAhead(state, p, heading, 3.5)
  if (nearest && nd < 3) {
    const away = normalize(sub(p.pos, nearest.pos))
    heading = normalize(addScaled(heading, away, (3 - nd) / 2))
  }
  if (open) {
    // Space in front: carry the ball forward.
    p.moveIntent = { x: heading.x * 0.85, y: heading.y * 0.85 }
    p.sprint = nd > 4
    p.sole = false
  } else {
    // Blocked: do not run into the defender; protect the ball and look for the circulation pass.
    p.moveIntent = { x: heading.x * 0.25, y: heading.y * 0.25 }
    p.sprint = false
    p.sole = nd < 1.6
  }

  if (!decide) return
  const a = p.profile.attributes
  const toGoal = dist(p.pos, goal)
  const pressure = pressureOn(state, p)
  const minHold = state.ball.lastTouchTeam === p.team && p.aiHoldTimer < 0.3 ? 0.25 : 0.3

  if (p.aiHoldTimer < minHold) return

  // Shoot when in range with a reasonably open lane.
  const lane = shootingLane(state, p, goal.y)
  const shootRange = attr(a.finishing, 11, 15)
  const angleOk = Math.abs(p.pos.x) < Math.abs(p.pos.y - goal.y) * 1.6 + 1
  if (angleOk && toGoal < shootRange && (lane > 0.3 || toGoal < 8)) {
    const chance = clamp(0.35 + (shootRange - toGoal) / shootRange + attr(a.decisions, 0, 0.2), 0, 0.95)
    if (rng.chance(chance)) {
      // Close in: a quick low placed shot into the corner; further out: a firmer, slightly higher shot.
      const power = toGoal < 7.5 ? 0.3 : clamp(0.42 + (toGoal - 7.5) / 25, 0.42, 0.68)
      actions.shoot(p, sub(goal, p.pos), power)
      return
    }
  } else if (angleOk && toGoal < 19 && lane > 0.8 && rng.chance(attr(a.shotPower, 0.04, 0.12))) {
    // Occasional long-range attempt through an open lane.
    actions.shoot(p, sub(goal, p.pos), 0.7)
    return
  }

  // 1) Direct play: a forward pass to a teammate who is free in a scoring position goes immediately.
  const chance = forwardChance(state, p)
  if (chance) {
    actions.pass(p, sub(chance.player.pos, p.pos), chance.through, chance.player)
    return
  }

  // 2) Otherwise keep the ball moving: carry it while there is space, then circulate to a safe option.
  const circulateAfter = open ? attr(a.creativity, 1.6, 2.4) : attr(a.decisions, 1.0, 0.55)
  if (pressure > 0.45 || p.aiHoldTimer > circulateAfter) {
    const safe = safePassOption(state, p, pressure, rng)
    if (safe) {
      actions.pass(p, sub(safe.pos, p.pos), false, safe)
      return
    }
    // Nothing safe: under heavy pressure or after holding too long, take the best available option.
    const fallback = bestPassOption(state, p, rng)
    if (fallback && (pressure > 0.7 || p.aiHoldTimer > attr(a.creativity, 2.6, 3.4))) {
      actions.pass(p, sub(fallback.player.pos, p.pos), false, fallback.player)
    }
  }
}

/** No opponent within `range` metres in a 60-degree cone ahead of the player. */
function spaceAhead(state: MatchState, p: PlayerState, heading: Vec2, range: number): boolean {
  for (const o of state.players) {
    if (o.team === p.team) continue
    const to = sub(o.pos, p.pos)
    const d = len(to)
    if (d > range) continue
    if (to.x * heading.x + to.y * heading.y > d * 0.5) return false
  }
  return true
}

/** How dangerous a position is for scoring: close to goal with a shooting angle (0..1). */
function scoringValue(state: MatchState, team: number, pos: Vec2): number {
  const dir = state.teams[team as 0 | 1].attackDir
  const goal = { x: 0, y: dir * COURT.halfLength }
  const d = dist(pos, goal)
  const depthToLine = Math.abs(goal.y - pos.y)
  const angle = Math.abs(pos.x) < depthToLine * 1.6 + 1 ? 1 : 0.3
  return clamp((16 - d) / 10, 0, 1) * angle
}

/**
 * A forward pass to a teammate who is free in a scoring position: the lane is open, the receiver has
 * space, is clearly ahead of the ball and more dangerous than the carrier. Runners moving forward with
 * space behind the defence get a through pass.
 */
function forwardChance(state: MatchState, p: PlayerState): { player: PlayerState; through: boolean } | null {
  const dir = state.teams[p.team].attackDir
  const own = scoringValue(state, p.team, p.pos)
  let best: PlayerState | null = null
  let bestScore = 0
  let bestThrough = false
  for (const t of state.players) {
    if (t.team !== p.team || t.id === p.id || t.role === 'GK') continue
    const progress = (t.pos.y - p.pos.y) * dir
    if (progress < 1.5) continue
    const d = dist(t.pos, p.pos)
    if (d > 20) continue
    const lane = laneOpenness(state, p.team, p.pos, t.pos)
    if (lane < 0.8) continue
    let space = Infinity
    for (const o of state.players)
      if (o.team !== p.team && o.role !== 'GK') space = Math.min(space, dist(o.pos, t.pos))
    if (space < 1.2) continue
    const danger = scoringValue(state, p.team, t.pos)
    if (danger < 0.2 || danger < own + 0.05) continue
    const score = danger * 2 + Math.min(lane, 3) * 0.3 + Math.min(space, 4) * 0.2
    if (score > bestScore) {
      bestScore = score
      best = t
      const runningForward = t.vel.y * dir > 1.5
      bestThrough = runningForward && spaceAhead(state, t, { x: 0, y: dir }, 3)
    }
  }
  return best ? { player: best, through: bestThrough } : null
}

/** Circulation pass: the most open nearby teammate (sideways or back), keeper only under real pressure. */
function safePassOption(
  state: MatchState,
  p: PlayerState,
  pressure: number,
  rng: SeededRandom,
): PlayerState | null {
  const dir = state.teams[p.team].attackDir
  let best: PlayerState | null = null
  let bestScore = -Infinity
  for (const t of state.players) {
    if (t.team !== p.team || t.id === p.id) continue
    if (t.role === 'GK' && (pressure < 0.7 || t.id === state.ball.keeperRetouchId)) continue
    const d = dist(t.pos, p.pos)
    if (d < 2.5 || d > 16) continue
    const lane = laneOpenness(state, p.team, p.pos, t.pos)
    if (lane < 0.9) continue
    let space = Infinity
    for (const o of state.players) if (o.team !== p.team) space = Math.min(space, dist(o.pos, t.pos))
    if (space < 1.5) continue
    const progress = ((t.pos.y - p.pos.y) * dir) / 10
    const score =
      Math.min(lane, 3) +
      Math.min(space, 4) * 0.4 +
      progress * 0.4 -
      Math.abs(d - 8) * 0.05 +
      rng.range(-0.1, 0.1)
    if (score > bestScore) {
      bestScore = score
      best = t
    }
  }
  return best
}

/** Score teammates as pass targets: lane openness, forward progress, receiver space; keeper only under pressure. */
function bestPassOption(
  state: MatchState,
  p: PlayerState,
  rng: SeededRandom,
): { player: PlayerState; score: number } | null {
  const dir = state.teams[p.team].attackDir
  const pressure = pressureOn(state, p)
  let best: PlayerState | null = null
  let bestScore = -Infinity
  for (const t of state.players) {
    if (t.team !== p.team || t.id === p.id) continue
    if (t.id === state.ball.keeperRetouchId) continue
    const d = dist(t.pos, p.pos)
    if (d < 2 || d > 22) continue
    const open = clamp(laneOpenness(state, p.team, p.pos, t.pos), -1, 3)
    let space = Infinity
    for (const o of state.players) if (o.team !== p.team) space = Math.min(space, dist(o.pos, t.pos))
    const progress = ((t.pos.y - p.pos.y) * dir) / 10
    const keeper = t.role === 'GK' ? -1.2 + pressure : 0
    const score = open * 0.9 + progress * 1.1 + Math.min(space, 4) * 0.3 + keeper + rng.range(-0.15, 0.15)
    if (score > bestScore) {
      bestScore = score
      best = t
    }
  }
  return best ? { player: best, score: bestScore } : null
}

function goalkeeperBehaviour(
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
  p.faceTarget = ball.pos

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
      for (const t of state.players) {
        if (t.team !== p.team || t.id === p.id) continue
        const open = clamp(laneOpenness(state, p.team, p.pos, t.pos), 0, 3)
        const score = open + rng.range(0, 0.4) - dist(t.pos, p.pos) / 20
        if (score > bestScore) {
          bestScore = score
          best = t
        }
      }
      if (best && ball.inHands) {
        // From the hands: the same controlled throw a human keeper makes (aim at where the receiver
        // will be; bowl short throws, throw long ones overarm).
        const target = predictPassTarget(p, best, false, state.teams[p.team].attackDir)
        const d = dist(target, p.pos)
        const wanted = clamp(rollingLaunchSpeed(d, PASS.arrivalSpeed), THROW.minSpeed, THROW.maxSpeed[1])
        const maxSpeed = attr(p.profile.attributes.throwing, THROW.maxSpeed[0], THROW.maxSpeed[1])
        const power = clamp((wanted - THROW.minSpeed) / (maxSpeed - THROW.minSpeed), 0.15, 1)
        actions.throwBall(p, sub(target, p.pos), power)
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
  const reacted = state.time - ball.kickTime >= reaction + screenDelay
  const threat =
    ball.mode === 'free' && ball.lastTouchTeam !== p.team && reacted
      ? predictGoalThreat(ball, goalLineY, p)
      : null
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

  // Angle positioning on the ball-goal line.
  p.aiState = 'position'
  const toBall = sub(ball.pos, goal)
  const db = len(toBall)
  const depth = clamp(0.5 + db * 0.07, 0.6, 2.2)
  const n = db > 1e-3 ? normalize(toBall) : { x: 0, y: dir }
  const target = {
    x: clamp(goal.x + n.x * depth, -1.7, 1.7),
    y: goalLineY + dir * Math.max(0.35, Math.abs(n.y * depth)),
  }
  walkTo(p, target, dist(target, p.pos) > 1.2)
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

/**
 * Openness of the best shooting lane: towards either corner of the goal, ignoring the goalkeeper
 * (who always stands on the line; beating him is the shot's job). Outfield blockers count.
 */
function shootingLane(state: MatchState, p: PlayerState, goalY: number): number {
  let best = -Infinity
  for (const cx of [-1.15, 1.15]) {
    const target = { x: cx, y: goalY }
    let open = Infinity
    for (const o of state.players) {
      if (o.team === p.team || o.role === 'GK') continue
      const { point, t } = closestOnSegment(p.pos, target, o.pos)
      open = Math.min(open, dist(point, o.pos) - t * 0.3)
    }
    best = Math.max(best, open)
  }
  return best
}
