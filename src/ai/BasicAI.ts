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
import { baseAnchor, diamondAnchor, dynamicAnchor } from './positioning/Formation'
import { clampRestartAim, restartTakerSpot } from '../simulation/RestartGeometry'
import { DIFFICULTY, type DifficultyParams } from '../simulation/Difficulty'

export interface AIActions {
  /** `arrival`: wanted ball speed at the receiver (default: a normal pass). */
  pass(
    p: PlayerState,
    dir: Vec2,
    through: boolean,
    receiver: PlayerState | null,
    power?: number,
    arrival?: number,
  ): void
  shoot(p: PlayerState, dir: Vec2, power: number): void
  /** Goalkeeper throw from the hands (same throw a human keeper makes). */
  throwBall(p: PlayerState, dir: Vec2, power: number): void
}

/** Difficulty parameters for a team: only the human's computer opponent is affected. */
/** Beyond this distance from our goal the presser contains (stands off) instead of engaging. */
const PRESS_ENGAGE_DISTANCE = 22

function difficultyFor(state: MatchState, team: TeamId): DifficultyParams {
  return state.humanTeam !== null && team !== state.humanTeam
    ? DIFFICULTY[state.difficulty]
    : DIFFICULTY.normal
}

export function updateAI(state: MatchState, actions: AIActions, rng: SeededRandom, dt: number): void {
  updateDefensiveTransitions(state)
  const chasers: [number | null, number | null] = [pickBallWinner(state, 0), pickBallWinner(state, 1)]
  const helpers: [number | null, number | null] = [
    pickHelper(state, 0, chasers[0]),
    pickHelper(state, 1, chasers[1]),
  ]
  for (const p of state.players) {
    p.aiSetPieceTimer = Math.max(0, p.aiSetPieceTimer - dt)
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
    const isWinner = chasers[p.team] === p.id || helpers[p.team] === p.id
    const staleChase = (p.aiState === 'chase' || p.aiState === 'press') !== isWinner
    if (decide || staleChase || p.aiState === '' || p.aiState === 'carry')
      offBallDecision(state, p, chasers[p.team], helpers[p.team])
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
  const ownGoal = { x: 0, y: -state.teams[team].attackDir * COURT.halfLength }
  // Counter-attack against us: a defender goal-side of the carrier engages him (delays him while the
  // others recover) rather than one chasing from behind.
  const preferGoalSide = owner !== null && state.defTransition[team]
  // Outnumbered (e.g. 2 v 1 against the fixo): the only outfield defender goal-side of the carrier
  // near our goal steps out to him and leaves his man.
  let lastMan: number | null = null
  if (owner && dist(owner.pos, ownGoal) < 18) {
    const goalSide = state.players.filter(
      (q) => q.team === team && q.role !== 'GK' && dist(q.pos, ownGoal) < dist(owner.pos, ownGoal) + 0.4,
    )
    if (goalSide.length === 1) lastMan = goalSide[0]!.id
  }
  let best: PlayerState | null = null
  let bestT = Infinity
  let humanT = Infinity
  for (const p of state.players) {
    if (p.team !== team || p.role === 'GK') continue
    let t = estimateTimeToReach(p, target)
    // The current presser keeps the job unless someone is clearly faster (no flicker between two).
    if (p.aiState === 'press' || p.aiState === 'chase') t -= 0.3
    if (preferGoalSide && dist(p.pos, ownGoal) > dist(target, ownGoal) - 0.5) t += 1.0
    // Near our goal the fixo does not leave a man he is marking in front of goal to press the ball
    // (unless he is the last man: then he must).
    if (p.id === lastMan) t -= 1.0
    else if (p.role === 'FIXO' && owner && dist(target, ownGoal) < 16 && fixoHasMan(state, p, owner.id))
      t += 0.8
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

function offBallDecision(
  state: MatchState,
  p: PlayerState,
  winnerId: number | null,
  helperId: number | null,
): void {
  const ball = state.ball
  const dir = state.teams[p.team].attackDir
  const owner = ball.ownerId !== null ? state.players[ball.ownerId]! : null
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
  let anchor = dynamicAnchor(p.role, inPossession ? 'attack' : 'defend', dir, ball.pos)
  if (inPossession && p.role === 'PIVOT') anchor = pivotAnchor(state, p, anchor)
  if (inPossession) {
    p.aiState = 'support'
    p.aiTarget = supportPosition(state, p, anchor)
  } else {
    p.aiState = 'cover'
    p.aiTarget = markingPosition(state, p, [winnerId, helperId])
  }
}

/**
 * Defending: every defender outside the press has one opponent to mark, chosen so that each
 * opponent is picked up by the defender whose diamond position is nearest (one-to-one). He stands
 * goal-side of his man, a little towards the ball, without leaving his zone of the diamond.
 */
function markingPosition(state: MatchState, p: PlayerState, pressing: (number | null)[]): Vec2 {
  const dir = state.teams[p.team].attackDir
  const ball = state.ball.pos
  const anchor = diamondAnchor(p.role, dir, ball)
  const man = markingAssignment(state, p.team, pressing).get(p.id)
  if (man === undefined) return anchor
  const a = state.players[man]!
  const ownGoal = { x: 0, y: -dir * COURT.halfLength }
  // Tighter the closer he is to goal and to the ball; looser far away (still goal-side).
  const tight = clamp(1 + (dist(a.pos, ownGoal) - 8) / 14 + (dist(a.pos, ball) - 6) / 20, 1, 2.2)
  const goalSide = addScaled(a.pos, normalize(sub(ownGoal, a.pos)), tight)
  // Inside shoulder: cover the middle side of the man (and a touch towards the ball).
  const inside = { x: -Math.sign(a.pos.x) * Math.min(0.8, Math.abs(a.pos.x) * 0.3), y: 0 }
  let mark = addScaled({ x: goalSide.x + inside.x, y: goalSide.y }, normalize(sub(ball, goalSide)), 0.15)
  // Help side: a man far from the ball is marked loosely, sagging towards the middle in front of goal
  // so the defender can cover a carrier who gets through.
  const away = clamp((dist(a.pos, ball) - 7) / 10, 0, 0.45)
  const middle = { x: a.pos.x * 0.3, y: (a.pos.y + ownGoal.y) / 2 }
  mark = { x: mark.x + (middle.x - mark.x) * away, y: mark.y + (middle.y - mark.y) * away }
  // A man in front of our goal is followed even outside the zone.
  if (dist(a.pos, ownGoal) < 9) return mark
  const off = sub(mark, anchor)
  // The fixo guards the middle and leaves his zone least.
  const zone = p.role === 'FIXO' ? 4 : p.role === 'PIVOT' ? 6.5 : 5.5
  const l = len(off)
  return l > zone ? addScaled(anchor, off, zone / l) : mark
}

/** An opponent (other than the carrier) within 4 m of the fixo, close to our goal. */
function fixoHasMan(state: MatchState, fixo: PlayerState, carrierId: number): boolean {
  const ownGoal = { x: 0, y: -state.teams[fixo.team].attackDir * COURT.halfLength }
  for (const o of state.players)
    if (
      o.team !== fixo.team &&
      o.role !== 'GK' &&
      o.id !== carrierId &&
      dist(o.pos, fixo.pos) < 4 &&
      dist(o.pos, ownGoal) < 12
    )
      return true
  return false
}

/** One-to-one marking assignment for a defending team: defender id -> opponent id. */
export function markingAssignment(
  state: MatchState,
  team: TeamId,
  pressing: (number | null)[],
): Map<number, number> {
  const dir = state.teams[team].attackDir
  const ball = state.ball.pos
  const defenders = state.players.filter(
    (d) => d.team === team && d.role !== 'GK' && d.id !== state.controlledId && !pressing.includes(d.id),
  )
  const attackers = state.players.filter(
    (o) => o.team !== team && o.role !== 'GK' && o.id !== state.ball.ownerId,
  )
  const anchors = defenders.map((d) => diamondAnchor(d.role, dir, ball))
  // Brute force over assignments (at most 4 x 4 = 24 permutations): minimum total distance.
  let best: number[] = []
  let bestCost = Infinity
  const used = new Array<boolean>(attackers.length).fill(false)
  const pick: number[] = []
  const n = Math.min(defenders.length, attackers.length)
  const rec = (i: number, cost: number) => {
    if (cost >= bestCost) return
    if (i === n) {
      bestCost = cost
      best = [...pick]
      return
    }
    for (let j = 0; j < attackers.length; j++) {
      if (used[j]) continue
      used[j] = true
      pick.push(j)
      rec(i + 1, cost + dist(anchors[i]!, attackers[j]!.pos))
      pick.pop()
      used[j] = false
    }
  }
  rec(0, 0)
  const out = new Map<number, number>()
  best.forEach((j, i) => out.set(defenders[i]!.id, attackers[j]!.id))
  return out
}

/**
 * Counter-attack detection. When a team loses the ball with at most one outfield player goal-side of
 * it, it is out of shape: the nearest player (preferably one goal-side) presses, the others sprint
 * back to their men (one-to-one marking) and the cover defender may step out anywhere. It returns to the diamond once the attackers play the ball
 * backwards, the ball goes dead (restart), three players are goal-side again or it wins the ball.
 */
export function updateDefensiveTransitions(state: MatchState): void {
  const ball = state.ball
  for (const team of [0, 1] as const) {
    const defending = state.possessionTeam !== null && state.possessionTeam !== team
    if (!defending || state.phase !== 'play') {
      state.defTransition[team] = false
      continue
    }
    const ownGoal = { x: 0, y: -state.teams[team].attackDir * COURT.halfLength }
    const ballToGoal = dist(ball.pos, ownGoal)
    let goalSide = 0
    for (const p of state.players)
      if (p.team === team && p.role !== 'GK' && dist(p.pos, ownGoal) < ballToGoal - 1) goalSide++
    // Caught out: the ball was lost with at most one outfield player goal-side of it.
    if (state.aiPrevPossession !== state.possessionTeam) state.defTransition[team] = goalSide < 2
    // Back in shape: three players goal-side of the ball again.
    if (goalSide >= 3) state.defTransition[team] = false
    if (state.defTransition[team] && ball.mode === 'free' && ball.intendedReceiverId !== null) {
      const recv = state.players[ball.intendedReceiverId]!
      const attackDir = state.teams[recv.team].attackDir
      // A pass backwards by the attackers: time to reorganise.
      if (recv.team !== team && ball.vel.y * attackDir < -2) state.defTransition[team] = false
    }
  }
  state.aiPrevPossession = state.possessionTeam
}

/**
 * Cover defender: when an opponent carries the ball in our half (within 28 m of goal) and the first
 * defender (usually the pivot at the top of the diamond) is beaten — not goal-side of him or more than
 * 3.5 m away — the next defender who can get goal-side of the carrier fastest goes to help: an ala, or
 * the fixo if nobody is near him.
 */
export function pickHelper(state: MatchState, team: TeamId, winnerId: number | null): number | null {
  if (state.phase !== 'play') return null
  const ball = state.ball
  const owner = ball.ownerId !== null ? state.players[ball.ownerId]! : null
  if (!owner || owner.team === team || ball.inHands || owner.role === 'GK') return null
  const ownGoal = { x: 0, y: -state.teams[team].attackDir * COURT.halfLength }
  const carrierToGoal = dist(owner.pos, ownGoal)
  const transition = state.defTransition[team]
  if (carrierToGoal > 28 && !transition) return null
  if (winnerId !== null) {
    const w = state.players[winnerId]!
    // Level with the carrier still counts (margin, so the help does not flicker on and off).
    const goalSide = dist(w.pos, ownGoal) < carrierToGoal + 0.4
    if (goalSide && dist(w.pos, owner.pos) < 3.5) return null
  }
  const spot = addScaled(owner.pos, normalize(sub(ownGoal, owner.pos)), 1.5)
  let best: PlayerState | null = null
  let bestT = Infinity
  for (const d of state.players) {
    if (d.team !== team || d.role === 'GK' || d.id === winnerId || d.id === state.controlledId) continue
    // The fixo only steps out if no opponent is near him (he would leave a man free in front of goal).
    if (d.role === 'FIXO' && !transition) {
      let near = false
      for (const o of state.players)
        if (o.team !== team && o.role !== 'GK' && o.id !== owner.id && dist(o.pos, d.pos) < 4) near = true
      if (near) continue
    }
    const t = estimateTimeToReach(d, spot)
    if (t < bestT) {
      bestT = t
      best = d
    }
  }
  return best ? best.id : null
}

export type RoutineRole = 'short' | 'pivot' | 'deep'

/**
 * Attacking kick-in (in the attacking half) or corner: the standard routine with movement so the
 * taker has options. The short man starts a few metres off and comes towards the ball (behind it, so
 * he can shoot first time), the pivot starts at the back post and comes out to the front of the area,
 * and the deep man leaves the halfway line to show for a pass back. Roles are fixed once per restart;
 * spots move with the time since the taker got ready.
 */
export function setPieceRoutine(
  state: MatchState,
  team: TeamId,
): { id: number; spot: Vec2; role: RoutineRole }[] | null {
  const r = state.restart
  if (!r || r.team !== team || (r.type !== 'kickIn' && r.type !== 'corner')) return null
  const dir = state.teams[team].attackDir
  if (r.type === 'kickIn' && r.spot.y * dir < 2) return null
  const goalY = dir * COURT.halfLength
  const side = Math.sign(r.spot.x) || 1
  const inward = { x: -side, y: 0 }
  const back = { x: 0, y: -dir }
  const inCourt = (v: Vec2) => ({ x: clamp(v.x, -9.2, 9.2), y: clamp(v.y, -18.8, 18.8) })
  const at = (a: number, b: number) =>
    inCourt({ x: r.spot.x + inward.x * a + back.x * b, y: r.spot.y + inward.y * a + back.y * b })
  const start = [at(5.5, 4.5), { x: -side * 1.6, y: goalY - dir * 1.3 }, { x: side * -1.5, y: -dir * 1 }]
  const roles: RoutineRole[] = ['short', 'pivot', 'deep']
  if (!r.routineIds) {
    const free = state.players.filter((p) => p.team === team && p.role !== 'GK' && p.id !== r.takerId)
    const ids: number[] = []
    for (const spot of start) {
      if (!free.length) break
      let bi = 0
      for (let k = 1; k < free.length; k++) if (dist(free[k]!.pos, spot) < dist(free[bi]!.pos, spot)) bi = k
      ids.push(free[bi]!.id)
      free.splice(bi, 1)
    }
    r.routineIds = ids
  }
  const t = r.ready ? r.readyTimer : 0
  const moved = [
    t > 0.5 ? at(2.6, 1.8) : start[0]!,
    t > 0.9 ? { x: side * 1.0, y: goalY - dir * 5.5 } : start[1]!,
    t > 1.3 ? at(3.5, 7) : start[2]!,
  ]
  return r.routineIds.map((id, k) => ({ id, spot: moved[k]!, role: roles[k]! }))
}

/**
 * The pivot does not stay in the middle: every few seconds he moves between the middle, the ball-side
 * wing and the far post/wing to find space (deterministic rhythm per team and half).
 */
function pivotAnchor(state: MatchState, p: PlayerState, anchor: Vec2): Vec2 {
  const dir = state.teams[p.team].attackDir
  const phase = Math.floor((state.tick + p.team * 157) / (60 * 4.5)) % 3
  const ballSide = Math.sign(state.ball.pos.x) || 1
  if (phase === 0) return anchor
  const x = phase === 1 ? ballSide * 6.2 : -ballSide * 4.5
  // On the wing a little deeper towards the goal line.
  const y = clamp(anchor.y + dir * 1.5, -COURT.halfLength + 3, COURT.halfLength - 3)
  return { x, y }
}

/** Move off the anchor towards a spot with an open passing lane to the ball. */
function supportPosition(state: MatchState, p: PlayerState, anchor: Vec2): Vec2 {
  const ballPos = state.ball.pos
  const dir = state.teams[p.team].attackDir
  let best = anchor
  let bestScore = -Infinity
  // Candidates in rings round the shape position (up to 5 m) and a "show" spot towards the ball.
  const cands: Vec2[] = [anchor]
  for (const r of [1.6, 3.2, 5])
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4 + (r === 3.2 ? Math.PI / 8 : 0)
      cands.push({ x: anchor.x + Math.cos(a) * r, y: anchor.y + Math.sin(a) * r })
    }
  const toBall = sub(ballPos, p.pos)
  if (len(toBall) > 6) cands.push(addScaled(p.pos, normalize(toBall), Math.min(4, len(toBall) - 5)))
  for (const raw of cands) {
    const c = { x: clamp(raw.x, -9.3, 9.3), y: clamp(raw.y, -18.8, 18.8) }
    const lane = clamp(laneOpenness(state, p.team, ballPos, c), 0, 3)
    const d = dist(c, ballPos)
    // Passing distance: not on top of the carrier, not too far for a ground pass.
    const range = d < 3.5 ? -2 : d > 15 ? -(d - 15) * 0.35 : 0
    // Get free from the marker: distance to the nearest opponent counts.
    let free = Infinity
    for (const o of state.players)
      if (o.team !== p.team && o.role !== 'GK') free = Math.min(free, dist(o.pos, c))
    // Keep spacing from teammates (no two players offering the same option).
    let crowd = 0
    for (const t of state.players)
      if (t.team === p.team && t.id !== p.id && t.id !== state.ball.ownerId && dist(t.pos, c) < 3)
        crowd -= 0.8
    // Slight preference for forward options and for the spot he is already heading to (stability).
    const forward = ((c.y - ballPos.y) * dir) / 20
    const keep = dist(c, p.aiTarget) < 1 ? 0.3 : 0
    const score =
      lane * 0.9 + Math.min(free, 4) * 0.8 + range + crowd + forward * 0.6 + keep - dist(c, anchor) * 0.15
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  return best
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

/**
 * Interception of an opponent's ground pass in flight: the earliest point on the ball's path that
 * this player reaches first (with an anticipation-based read delay), before the receiver gets it.
 */
export function passInterception(state: MatchState, p: PlayerState): Vec2 | null {
  const ball = state.ball
  if (ball.mode !== 'free' || ball.intendedReceiverId === null || ball.lastTouchTeam === p.team) return null
  if (ball.z > 1.1 || len(ball.vel) < 4) return null
  const receiver = state.players[ball.intendedReceiverId]!
  if (receiver.team === p.team) return null
  const toReceiver = dist(ball.pos, receiver.pos)
  const read = Math.max(
    0,
    attr(p.profile.attributes.anticipation, 0.3, 0.08) + difficultyFor(state, p.team).readDelay,
  )
  let pos = ball.pos
  let vel = ball.vel
  let travelled = 0
  const h = 0.05
  for (let t = h; t < 2; t += h) {
    const s = len(vel)
    if (s < 0.5) break
    const ns = Math.max(0, s - 1.8 * h)
    vel = { x: (vel.x / s) * ns, y: (vel.y / s) * ns }
    pos = addScaled(pos, vel, h)
    travelled += ns * h
    if (travelled > toReceiver - 0.8) break
    // He only has to get a foot to it: reach the ball's path within about 0.6 m.
    const gap = dist(p.pos, pos)
    const reachAt = gap > 0.6 ? addScaled(pos, normalize(sub(p.pos, pos)), 0.6) : p.pos
    if (estimateTimeToReach(p, reachAt) + read <= t) return pos
  }
  return null
}

function steer(state: MatchState, p: PlayerState): void {
  const owner = state.ball.ownerId !== null ? state.players[state.ball.ownerId]! : null
  const engage =
    owner !== null &&
    dist(owner.pos, { x: 0, y: -state.teams[p.team].attackDir * COURT.halfLength }) <= PRESS_ENGAGE_DISTANCE
  if (p.aiState === 'press' && owner && owner.team !== p.team && engage && dist(owner.pos, p.pos) < 2.2) {
    // Close to the carrier: track him every tick and step in on the ball (where it is going), so a
    // dribbler has to beat him rather than just walk round a static marker.
    const to = sub(state.ball.pos, p.pos)
    const k = attr((p.profile.attributes.tackling + p.profile.attributes.agility) / 2, 0.78, 0.98)
    p.moveIntent = len(to) > 0.05 ? { x: normalize(to).x * k, y: normalize(to).y * k } : { x: 0, y: 0 }
    p.sprint = false
    p.faceTarget = state.ball.pos
    return
  }
  const d = dist(p.aiTarget, p.pos)
  // In a counter-attack against us everybody sprints back to his man.
  const recovering = p.aiState === 'cover' && state.defTransition[p.team] && d > 1.5
  // Getting free: a supporting player sprints into space when his spot is a few metres away.
  const showing = p.aiState === 'support' && d > 2.5
  const urgent =
    p.aiState === 'chase' ||
    p.aiState === 'intercept' ||
    (p.aiState === 'press' && d > 2.5) ||
    d > 5 ||
    recovering ||
    showing
  // A marker whose spot is on the far side of an opponent goes round him (to get goal-side of his
  // man) instead of walking into his back.
  const target =
    p.aiState === 'cover' || p.aiState === 'press' ? aroundBodies(state, p, p.aiTarget) : p.aiTarget
  walkTo(p, target, urgent)
  if (p.aiState === 'press' && d < 1.5) {
    p.moveIntent = { x: p.moveIntent.x * 0.6, y: p.moveIntent.y * 0.6 }
  }
  if (p.aiState !== 'chase') p.faceTarget = state.ball.pos
}

/** Detour point round the first opponent standing in the way to `target` (else `target`). */
function aroundBodies(state: MatchState, p: PlayerState, target: Vec2): Vec2 {
  const to = sub(target, p.pos)
  if (len(to) < 0.3) return target
  for (const o of state.players) {
    if (o.team === p.team || o.role === 'GK') continue
    if (dist(o.pos, p.pos) > 4) continue
    const { point, t } = closestOnSegment(p.pos, target, o.pos)
    if (t <= 0.02 || t >= 0.98 || dist(point, o.pos) > 0.75) continue
    // Pass on the side that makes the shorter way round (stable from tick to tick).
    const n = normalize(to)
    const left = addScaled(o.pos, { x: -n.y, y: n.x }, 1.0)
    const right = addScaled(o.pos, { x: n.y, y: -n.x }, 1.0)
    const via = (w: Vec2) => dist(p.pos, w) + dist(w, target)
    return via(left) <= via(right) ? left : right
  }
  return target
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

  // Set-piece shooter: the routine's easy pass is struck first time.
  if (decide && p.aiSetPieceTimer > 0 && dist(p.pos, goal) < 14.5) {
    const angleOk = Math.abs(p.pos.x) < Math.abs(p.pos.y - goal.y) * 1.6 + 1
    if (angleOk) {
      p.aiSetPieceTimer = 0
      actions.shoot(p, sub(goal, p.pos), 0.55)
      return
    }
  }

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
  // Through on goal: no outfield defender between the carrier and the goal. Take the ball in close
  // and finish past the keeper instead of shooting from distance or passing.
  if (isBreakaway(state, p, goal)) {
    breakawayBehaviour(state, p, goal, actions, rng, decide)
    return
  }
  p.aiBreakawayCorner = 0

  // 1v1 dribble challenge in progress: burst past the defender on the chosen side.
  if (p.aiChallengeTimer > 0) {
    p.aiChallengeTimer -= dt
    if (challengeBehaviour(state, p, nearest)) {
      if (decide && p.aiHoldTimer > 0.25) {
        const toGoalNow = dist(p.pos, goal)
        if (toGoalNow < 9 && shootingLane(state, p, goal.y) > 0.3) {
          actions.shoot(p, sub(goal, p.pos), toGoalNow < 7.5 ? 0.3 : 0.45)
          p.aiChallengeTimer = 0
        }
      }
      return
    }
    p.aiChallengeTimer = -1
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
    // Shield: under close pressure turn the back to the opponent, body between him and the ball.
    if (p.sole && nearest) p.faceTarget = addScaled(p.pos, normalize(sub(p.pos, nearest.pos)), 3)
  }

  if (!decide) return
  const a = p.profile.attributes
  const toGoal = dist(p.pos, goal)
  const pressure = pressureOn(state, p)

  const minHold = state.ball.lastTouchTeam === p.team && p.aiHoldTimer < 0.3 ? 0.25 : 0.3

  if (p.aiHoldTimer < minHold) return

  // Shoot when in range with a reasonably open lane.
  const lane = shootingLane(state, p, goal.y)
  const shootRange = attr(a.finishing, 9.5, 12.5)
  const angleOk = Math.abs(p.pos.x) < Math.abs(p.pos.y - goal.y) * 1.6 + 1
  if (angleOk && toGoal < shootRange && (lane > 0.3 || toGoal < 8)) {
    const chance = clamp(0.35 + (shootRange - toGoal) / shootRange + attr(a.decisions, 0, 0.2), 0, 0.95)
    if (rng.chance(chance)) {
      // Close in: a quick low placed shot into the corner; further out: a firmer, slightly higher shot.
      const power = toGoal < 7.5 ? 0.3 : clamp(0.42 + (toGoal - 7.5) / 25, 0.42, 0.68)
      actions.shoot(p, sub(goal, p.pos), power)
      return
    }
  } else if (angleOk && toGoal < 15 && lane > 1.2 && rng.chance(attr(a.shotPower, 0.008, 0.025))) {
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

  // 2) Take the defender on (wing or middle; never the last man).
  if (startChallenge(state, p, nearest, rng)) return

  // 3) Play forward: a pass to a teammate ahead with an open lane, once the carry stalls.
  if (!open || pressure > 0.35 || p.aiHoldTimer > attr(a.vision, 0.9, 0.5)) {
    const ahead = progressivePass(state, p)
    if (ahead) {
      actions.pass(p, sub(ahead.pos, p.pos), false, ahead)
      return
    }
  }

  // 4) Otherwise keep the ball moving: carry it while there is space, then circulate (back / across).
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

/**
 * Breakaway: no outfield opponent goal-side of the carrier near the line to goal (a defender level
 * with him or chasing from behind does not count). Only in the attacking half.
 */
export function isBreakaway(state: MatchState, p: PlayerState, goal: Vec2): boolean {
  const dir = state.teams[p.team].attackDir
  const toGoal = dist(p.pos, goal)
  if (toGoal > COURT.halfLength || toGoal < 2) return false
  for (const o of state.players) {
    if (o.team === p.team || o.role === 'GK') continue
    const ahead = (o.pos.y - p.pos.y) * dir
    // Behind him, or level but out to the side: not in the way (a duel at his shoulder still is).
    if (ahead < -0.3 || (ahead < 0.6 && Math.abs(o.pos.x - p.pos.x) > 1.5)) continue
    const { point } = closestOnSegment(p.pos, goal, o.pos)
    if (dist(point, o.pos) < 2.6) return false
  }
  return true
}

/**
 * One-on-one with the keeper: run at goal and, once close (or when a defender or the keeper closes
 * in), finish with a placed low shot into the near or far corner. Mostly placed (keeper can at best
 * parry), sometimes struck firmer (he may hold it).
 */
function breakawayBehaviour(
  state: MatchState,
  p: PlayerState,
  goal: Vec2,
  actions: AIActions,
  rng: SeededRandom,
  decide: boolean,
): void {
  const a = p.profile.attributes
  const dir = state.teams[p.team].attackDir
  // Pick the corner once per breakaway: far corner (across the keeper) or near corner.
  if (p.aiBreakawayCorner === 0) {
    const nearSide = Math.abs(p.pos.x) > 0.8 ? Math.sign(p.pos.x) : rng.chance(0.5) ? 1 : -1
    p.aiBreakawayCorner = rng.chance(0.6) ? -nearSide : nearSide
  }
  // Run towards a point in front of goal, slightly off-centre so the angle stays open.
  const target = { x: clamp(p.pos.x * 0.6, -3, 3), y: goal.y - dir * 5.5 }
  const heading = normalize(sub(target, p.pos))
  p.moveIntent = { x: heading.x * 0.9, y: heading.y * 0.9 }
  let chaser = Infinity
  let keeperDist = Infinity
  for (const o of state.players) {
    if (o.team === p.team) continue
    const d = dist(o.pos, p.pos)
    if (o.role === 'GK') keeperDist = d
    else chaser = Math.min(chaser, d)
  }
  const toGoal = dist(p.pos, goal)
  p.sprint = toGoal > 11 && chaser < 4
  p.sole = false
  if (!decide || p.aiHoldTimer < 0.2) return
  const shootAt = attr(a.composure, 8.5, 7)
  const angleOk = Math.abs(p.pos.x) < Math.abs(p.pos.y - goal.y) * 1.6 + 1
  const forced = (chaser < 1.6 && toGoal < 11) || keeperDist < 3.2 || (p.pos.y - target.y) * dir > 0
  if (!angleOk || (toGoal > shootAt && !forced)) return
  // Corner choice as lateral input (planShot aims at the corner on that side).
  const power = rng.chance(attr(a.finishing, 0.55, 0.85)) ? 0.3 : 0.45
  actions.shoot(p, { x: p.aiBreakawayCorner, y: dir * 0.4 }, power)
  p.aiBreakawayCorner = 0
}

/** The deepest outfield player of his team (the last man): he does not take players on. */
export function isLastMan(state: MatchState, p: PlayerState): boolean {
  const dir = state.teams[p.team].attackDir
  for (const t of state.players)
    if (t.team === p.team && t.role !== 'GK' && t.id !== p.id && t.pos.y * dir < p.pos.y * dir) return false
  return true
}

/**
 * Start a 1v1 dribble challenge: one defender close in front, no cover behind him, and the carrier
 * is not the last man. Better dribblers try it more often. On the wing he either cuts inside or goes
 * down the line; in the middle he goes past on the side away from the defender.
 */
function startChallenge(
  state: MatchState,
  p: PlayerState,
  defender: PlayerState | null,
  rng: SeededRandom,
): boolean {
  if (!defender || defender.role === 'GK' || isLastMan(state, p)) return false
  const dir = state.teams[p.team].attackDir
  if (p.pos.y * dir < -8) return false // not deep in his own half
  const ahead = (defender.pos.y - p.pos.y) * dir
  const lateral = defender.pos.x - p.pos.x
  if (ahead < 0.4 || ahead > 4.5 || Math.abs(lateral) > 2.5) return false
  // Cover: another defender just behind the first one closes the gap.
  const beyond = { x: defender.pos.x, y: defender.pos.y + dir * 2.5 }
  for (const o of state.players)
    if (o.team !== p.team && o.id !== defender.id && o.role !== 'GK' && dist(o.pos, beyond) < 3) return false
  // One decision per possession (the first time a defender stands in front of him).
  if (p.aiChallengeTimer < 0) return false
  const a = p.profile.attributes
  if (!rng.chance(attr(a.dribbling, 0.22, 0.6))) {
    p.aiChallengeTimer = -1
    return false
  }
  const edge = COURT.halfWidth - 1.6
  let side: number
  if (Math.abs(p.pos.x) > 5) {
    // Wing: cut inside, or down the line when there is room.
    const lineSide = Math.sign(p.pos.x)
    side = Math.abs(p.pos.x) < edge && rng.chance(0.5) ? lineSide : -lineSide
  } else {
    side = Math.abs(lateral) > 0.3 ? -Math.sign(lateral) : rng.chance(0.5) ? 1 : -1
  }
  p.aiChallengeSide = side
  p.aiChallengeTimer = attr(a.agility, 1.0, 1.4)
  return true
}

/** Steer the challenge; returns false once it is over (defender beaten or no longer in the way). */
function challengeBehaviour(state: MatchState, p: PlayerState, defender: PlayerState | null): boolean {
  if (!defender) return false
  const dir = state.teams[p.team].attackDir
  const ahead = (defender.pos.y - p.pos.y) * dir
  if (ahead < -0.8 || dist(defender.pos, p.pos) > 5) return false // beaten / gone
  // Do not run out of the court.
  if (Math.abs(p.pos.x) > COURT.halfWidth - 0.9 && Math.sign(p.pos.x) === p.aiChallengeSide)
    p.aiChallengeSide = -p.aiChallengeSide
  // Sideways burst while the defender is in front, then turn upfield past him.
  const sideWeight = ahead > 0 ? 1.15 : 0.5
  const m = normalize({ x: p.aiChallengeSide * sideWeight, y: dir })
  p.moveIntent = { x: m.x, y: m.y }
  p.sprint = true
  p.sole = false
  p.aiState = 'challenge'
  return true
}

/** Progressive pass: an outfield teammate clearly ahead with an open lane and space (no keeper). */
function progressivePass(state: MatchState, p: PlayerState): PlayerState | null {
  const dir = state.teams[p.team].attackDir
  let best: PlayerState | null = null
  let bestScore = 0
  for (const t of state.players) {
    if (t.team !== p.team || t.id === p.id || t.role === 'GK') continue
    const progress = (t.pos.y - p.pos.y) * dir
    if (progress < 2.5) continue
    const d = dist(t.pos, p.pos)
    if (d > 18) continue
    const lane = laneOpenness(state, p.team, p.pos, t.pos)
    if (lane < 0.9) continue
    let space = Infinity
    for (const o of state.players) if (o.team !== p.team) space = Math.min(space, dist(o.pos, t.pos))
    if (space < 1.6) continue
    const score =
      progress * 0.12 +
      scoringValue(state, p.team, t.pos) * 1.5 +
      Math.min(lane, 3) * 0.3 +
      Math.min(space, 4) * 0.2
    if (score > bestScore) {
      bestScore = score
      best = t
    }
  }
  return best
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
    // A tightly marked receiver is a bad option even with an open lane.
    const marked = space < 1.3 ? -1.5 : 0
    const score =
      open * 0.9 + progress * 1.1 + Math.min(space, 4) * 0.3 + keeper + marked + rng.range(-0.15, 0.15)
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
