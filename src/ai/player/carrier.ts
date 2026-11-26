/** The ball carrier: dribbling, shooting, passing decisions, 1 v 1 challenges, breakaways. */
import { attr, clamp } from '../../core/math/scalar'
import type { SeededRandom } from '../../core/random/SeededRandom'
import { addScaled, closestOnSegment, dist, normalize, sub, type Vec2 } from '../../core/math/vec2'
import { pressureOn } from '../../physics/PassingPhysics'
import { estimateTimeToReach } from '../../physics/PlayerPhysics'
import type { MatchState, PlayerState, TeamId } from '../../simulation/MatchState'
import { COURT } from '../../simulation/SimulationConfig'
import { screenFactor } from '../../simulation/MatchSimulation'
import { type AIActions, spaceAhead, shootingLane, isLastMan, deepestOutfield } from '../common'
import { runnerOption } from '../team/attacking'
import {
  progressivePass,
  forwardChance,
  safePassOption,
  bestPassOption,
  passInterceptable,
  pivotPass,
} from '../passing'

export function carrierBehaviour(
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
      p.aiDecision = 'setPiece'
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
          p.aiDecision = 'challengeShot'
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
    // Blocked: do not run into the defender; protect the ball and look for the circulation pass. With
    // the presser right on him he turns away from him (sideways / back) instead of into him.
    const escape =
      nearest && nd < 2.2
        ? normalize({
            x: (p.pos.x - nearest.pos.x) * 1.0 + heading.x * 0.3,
            y: (p.pos.y - nearest.pos.y) * 1.0 + heading.y * 0.3,
          })
        : heading
    heading = escape
    p.moveIntent = { x: heading.x * 0.45, y: heading.y * 0.45 }
    p.sprint = false
    p.sole = nd < 1.6
    // Shield: under close pressure turn the back to the opponent, body between him and the ball.
    if (p.sole && nearest) p.faceTarget = addScaled(p.pos, normalize(sub(p.pos, nearest.pos)), 3)
  }

  if (!decide) return
  const toGoal = dist(p.pos, goal)
  // Pressure, anticipated: a presser arriving within 0.8 s counts already, so the ball is released
  // while the safe option is still open (the human player closes down fast).
  let incoming = Infinity
  for (const o of state.players)
    if (o.team !== p.team && o.role !== 'GK')
      incoming = Math.min(incoming, estimateTimeToReach(o, p.pos) * (o.id === state.controlledId ? 0.85 : 1))
  const pressure = Math.max(pressureOn(state, p), incoming < 0.5 ? 0.6 : incoming < 0.8 ? 0.45 : 0)

  const minHold = state.ball.lastTouchTeam === p.team && p.aiHoldTimer < 0.3 ? 0.25 : 0.3

  if (p.aiHoldTimer < minHold) return

  // Utility-based decision: every option the carrier has gets a score and the best one is taken.
  const options = carrierOptions(state, p, rng, { open, pressure, toGoal, goal, nearest })
  const best = options.reduce<CarrierOption | null>((b, o) => (!b || o.utility > b.utility ? o : b), null)
  p.aiDecision = best ? best.kind : 'carry'
  if (best) {
    best.act(actions)
    // Pass and move: after a pass forward or across he goes into space for the return (give-and-go).
    if (
      best.kind === 'progressive' ||
      best.kind === 'circulate' ||
      best.kind === 'direct' ||
      best.kind === 'pivot'
    )
      passAndMove(state, p)
  }
}

export type CarrierOptionKind =
  | 'shoot'
  | 'longShot'
  | 'direct'
  | 'through'
  | 'challenge'
  | 'progressive'
  | 'circulate'
  | 'fallback'
  | 'clear'
  | 'pivot'
  | 'layoff'

export interface CarrierOption {
  kind: CarrierOptionKind
  /** Higher is better. Bands keep the futsal priorities; within a band the values compete. */
  utility: number
  act: (actions: AIActions) => void
}

/**
 * Rough expected-goal value of a shot from `pos` (distance, angle, open lane, pressure). Used to
 * compare shooting with passing to a teammate in a better position.
 */
export function shotValue(
  state: MatchState,
  team: TeamId,
  pos: Vec2,
  lane: number,
  pressure: number,
): number {
  const goal = { x: 0, y: state.teams[team].attackDir * COURT.halfLength }
  const d = dist(pos, goal)
  const depth = Math.abs(goal.y - pos.y)
  const angle = Math.abs(pos.x) < depth * 1.6 + 1 ? 1 : 0.35
  const base = clamp(0.55 - (d - 4) * 0.05, 0.02, 0.55)
  return base * angle * (lane > 0.3 ? 1 : 0.45) * (1 - pressure * 0.4)
}

interface CarrierContext {
  open: boolean
  pressure: number
  toGoal: number
  goal: Vec2
  nearest: PlayerState | null
}

/** All options the carrier has this decision, with utilities (see CarrierOption). */
export function carrierOptions(
  state: MatchState,
  p: PlayerState,
  rng: SeededRandom,
  c: CarrierContext,
): CarrierOption[] {
  const a = p.profile.attributes
  const out: CarrierOption[] = []
  const lane = shootingLane(state, p, c.goal.y)
  // Shoot from where a shot is worth it (from 10 m+ a keeper with a clear view saves nearly all).
  const shootRange = attr(a.finishing, 8, 10.5)
  const angleOk = Math.abs(p.pos.x) < Math.abs(p.pos.y - c.goal.y) * 1.6 + 1
  const myValue = shotValue(state, p.team, p.pos, lane, c.pressure)

  // Shooting band (0.9+): in range with a lane, decided with the player's willingness to shoot.
  if (angleOk && c.toGoal < shootRange && (lane > 0.3 || c.toGoal < 8)) {
    const chance = clamp(0.35 + (shootRange - c.toGoal) / shootRange + attr(a.decisions, 0, 0.2), 0, 0.95)
    if (rng.chance(chance)) {
      // Close in: a quick low placed shot into the corner; further out: a firmer, slightly higher shot.
      const power = c.toGoal < 8.5 ? 0.3 : clamp(0.42 + (c.toGoal - 8.5) / 25, 0.42, 0.62)
      out.push({
        kind: 'shoot',
        utility: 0.9 + myValue * 0.1,
        act: (x) => x.shoot(p, sub(c.goal, p.pos), power),
      })
    }
  } else if (angleOk && c.toGoal < 14.5 && lane > 0.6) {
    // From distance: worth it when a player screens the keeper's view ("maski"), occasionally
    // otherwise through a wide-open lane.
    const keeper = state.players.find((q) => q.team !== p.team && q.role === 'GK')
    const screen = keeper ? screenFactor(state, p, keeper) : 0
    const chance =
      screen > 0.3 ? attr(a.shotPower, 0.12, 0.25) * screen : lane > 1.2 ? attr(a.shotPower, 0.008, 0.025) : 0
    if (chance > 0 && rng.chance(chance))
      out.push({ kind: 'longShot', utility: 0.88, act: (x) => x.shoot(p, sub(c.goal, p.pos), 0.62) })
  }

  // Direct play band (0.8+): a forward pass to a teammate free in a scoring position. If his shot is
  // clearly better than ours (the square ball), it beats our own shot.
  const chance = forwardChance(state, p)
  if (chance) {
    const theirValue = shotValue(state, p.team, chance.player.pos, 1, 0)
    const betterThanShooting = theirValue > myValue * 1.6 + 0.05
    out.push({
      kind: 'direct',
      utility: (betterThanShooting ? 1.0 : 0.8) + theirValue * 0.1,
      act: (x) => x.pass(p, sub(chance.player.pos, p.pos), chance.through, chance.player),
    })
  }

  // A teammate running in behind with an open lane: the through ball into his path.
  const runner = runnerOption(state, p)
  if (runner)
    out.push({ kind: 'through', utility: 0.78, act: (x) => x.pass(p, sub(runner.pos, p.pos), true, runner) })

  // The vertical ball into the pivot: whenever the lane to his feet is open (a marker behind him does
  // not matter), not only once the carry stalls.
  if (p.aiHoldTimer > 0.3) {
    const pivot = pivotPass(state, p)
    if (pivot)
      out.push({
        kind: 'pivot',
        utility: 0.76 + shotValue(state, p.team, pivot.pos, 1, 0) * 0.1,
        act: (x) => x.pass(p, sub(pivot.pos, p.pos), false, pivot),
      })
  }

  // The pivot holding it up: lay it off to a teammate arriving behind him with a better shot, who
  // strikes it first time.
  const lay = layoffOption(state, p, myValue)
  if (lay)
    out.push({
      kind: 'layoff',
      utility: 0.84,
      act: (x) => {
        lay.aiSetPieceTimer = 1.5
        x.pass(p, sub(lay.pos, p.pos), false, lay)
      },
    })

  // Take the defender on (wing or middle; never the last man). Decided once per possession.
  if (!out.some((o) => o.utility >= 0.78) && startChallenge(state, p, c.nearest, rng))
    out.push({ kind: 'challenge', utility: 0.7, act: () => undefined })

  // Play forward once the carry stalls.
  if (!c.open || c.pressure > 0.35 || p.aiHoldTimer > attr(a.vision, 0.9, 0.5)) {
    const ahead = progressivePass(state, p)
    if (ahead)
      out.push({
        kind: 'progressive',
        utility: 0.6 + shotValue(state, p.team, ahead.pos, 1, 0) * 0.1,
        act: (x) => x.pass(p, sub(ahead.pos, p.pos), false, ahead),
      })
  }

  // Danger zone: in our own third, under pressure, clear it long up the wing rather than risk losing
  // it near our goal (a safe pass, if there is one, still scores higher).
  const ownGoal = { x: 0, y: -c.goal.y }
  if (dist(p.pos, ownGoal) < 13 && c.pressure > 0.4) {
    // Either wing, well up the court: the side nobody can cut it out on, else the one further from
    // the human player (who reads a long ball best), else his own side.
    const human = state.controlledId !== null ? state.players[state.controlledId]! : null
    const cands = [1, -1].map((side) => {
      const target = { x: side * 6.5, y: c.goal.y * 0.25 }
      // Kicked straight into the presser in front of him it is just a block: not that way.
      const along = normalize(sub(target, p.pos))
      const blocked = state.players.some((o) => {
        if (o.team === p.team) return false
        const rel = sub(o.pos, p.pos)
        const t = rel.x * along.x + rel.y * along.y
        return t > -0.2 && t < 3.5 && Math.abs(rel.x * -along.y + rel.y * along.x) < 1.3
      })
      if (blocked) return { target, score: -Infinity }
      const safe = !passInterceptable(state, p.team, p.pos, target)
      const fromHuman = human && human.team !== p.team ? dist(human.pos, target) : 0
      const own = side === (Math.sign(p.pos.x) || 1) ? 0.5 : 0
      return { target, score: (safe ? 10 : 0) + fromHuman * 0.3 + own }
    })
    const pick = cands[0]!.score >= cands[1]!.score ? cands[0]! : cands[1]!
    if (pick.score > -Infinity)
      out.push({
        kind: 'clear',
        utility: 0.35,
        act: (x) => x.pass(p, sub(pick.target, p.pos), true, null, undefined, 9),
      })
  }

  // Keep the ball moving: carry it while there is space, then circulate (back / across).
  const circulateAfter = c.open ? attr(a.creativity, 1.6, 2.4) : attr(a.decisions, 1.0, 0.55)
  if (c.pressure > 0.45 || p.aiHoldTimer > circulateAfter) {
    const safe = safePassOption(state, p, c.pressure, rng)
    if (safe)
      out.push({ kind: 'circulate', utility: 0.4, act: (x) => x.pass(p, sub(safe.pos, p.pos), false, safe) })
    else {
      // Nothing safe: under heavy pressure or after holding too long, the best available option.
      const fallback = bestPassOption(state, p, rng)
      // A pass an opponent can cut out is not worth it: shield and carry instead (only under the very
      // heaviest pressure does he risk it).
      const risky = fallback ? passInterceptable(state, p.team, p.pos, fallback.player.pos) : true
      if (fallback && !risky && (c.pressure > 0.7 || p.aiHoldTimer > attr(a.creativity, 2.6, 3.4)))
        out.push({
          kind: 'fallback',
          utility: 0.25,
          act: (x) => x.pass(p, sub(fallback.player.pos, p.pos), false, fallback.player),
        })
    }
  }
  return out
}

/**
 * Lay-off: the most advanced player (the pivot) with the ball in the attacking half plays it back to a
 * teammate arriving 2-7.5 m behind him who has a clearly better shot (a first-time strike).
 */
function layoffOption(state: MatchState, p: PlayerState, myValue: number): PlayerState | null {
  const dir = state.teams[p.team].attackDir
  if (p.pos.y * dir < 0) return null
  for (const t of state.players)
    if (t.team === p.team && t.role !== 'GK' && t.id !== p.id && (t.pos.y - p.pos.y) * dir > 0) return null
  let best: PlayerState | null = null
  let bestV = myValue * 1.3 + 0.03
  for (const t of state.players) {
    if (t.team !== p.team || t.role === 'GK' || t.id === p.id) continue
    const back = (p.pos.y - t.pos.y) * dir
    const d = dist(t.pos, p.pos)
    if (back < 1 || d < 2 || d > 7.5) continue
    let space = Infinity
    for (const o of state.players)
      if (o.team !== p.team && o.role !== 'GK') space = Math.min(space, dist(o.pos, t.pos))
    if (space < 1.8 || passInterceptable(state, p.team, p.pos, t.pos)) continue
    const v = shotValue(state, p.team, t.pos, 1, 0)
    if (v > bestV) {
      bestV = v
      best = t
    }
  }
  return best
}

/**
 * Pass and move: after releasing the ball the passer runs forward into space (a free lane, not the
 * deepest player, not if a run is already on), so the receiver can play it back into his path.
 */
function passAndMove(state: MatchState, p: PlayerState): void {
  if (p.role === 'GK' || deepestOutfield(state, p.team) === p.id || p.aiRunCooldown > 0) return
  if (state.players.some((t) => t.team === p.team && t.id !== p.id && t.aiRunTimer > 0)) return
  const dir = state.teams[p.team].attackDir
  const goalY = dir * COURT.halfLength
  // Forward and a little towards the middle, stopping short of the goal.
  const target = {
    x: clamp(p.pos.x * 0.7, -7.5, 7.5),
    y: clamp(p.pos.y + dir * 7, -COURT.halfLength + 4, COURT.halfLength - 4),
  }
  if ((goalY - target.y) * dir < 4) return
  for (const o of state.players) {
    if (o.team === p.team || o.role === 'GK') continue
    const { point } = closestOnSegment(p.pos, target, o.pos)
    if (dist(point, o.pos) < 1.8) return
  }
  p.aiRunTarget = target
  p.aiRunTimer = 1.8
  p.aiRunCooldown = 6
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
  const forced = (chaser < 1.2 && toGoal < 9.5) || keeperDist < 3.2 || (p.pos.y - target.y) * dir > 0
  if (!angleOk || (toGoal > shootAt && !forced)) return
  // Forced to finish from further out (keeper rushing out, a chaser on him): a teammate free closer
  // in gets the square ball instead of a shot the keeper will save.
  if (toGoal > shootAt) {
    const mate = forwardChance(state, p)
    if (mate && dist(mate.player.pos, goal) < toGoal - 2) {
      p.aiDecision = 'breakawaySquare'
      actions.pass(p, sub(mate.player.pos, p.pos), false, mate.player)
      p.aiBreakawayCorner = 0
      return
    }
  }
  // Corner choice as lateral input (planShot aims at the corner on that side). Close in a placed
  // side-foot; further out it needs pace to beat the keeper.
  const placed = rng.chance(attr(a.finishing, 0.55, 0.85))
  const power = toGoal < 8 ? (placed ? 0.3 : 0.45) : clamp(0.45 + (toGoal - 8) / 20, 0.45, 0.6)
  p.aiDecision = 'breakawayShot'
  actions.shoot(p, { x: p.aiBreakawayCorner, y: dir * 0.4 }, power)
  p.aiBreakawayCorner = 0
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
