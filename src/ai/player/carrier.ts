/** The ball carrier: dribbling, shooting, passing decisions, 1 v 1 challenges, breakaways. */
import { attr, clamp } from '../../core/math/scalar'
import type { SeededRandom } from '../../core/random/SeededRandom'
import { addScaled, closestOnSegment, dist, normalize, sub, type Vec2 } from '../../core/math/vec2'
import { pressureOn } from '../../physics/PassingPhysics'
import type { MatchState, PlayerState, TeamId } from '../../simulation/MatchState'
import { COURT } from '../../simulation/SimulationConfig'
import { type AIActions, spaceAhead, shootingLane, isLastMan } from '../common'
import { runnerOption } from '../team/attacking'
import { progressivePass, forwardChance, safePassOption, bestPassOption } from '../passing'

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
  const toGoal = dist(p.pos, goal)
  const pressure = pressureOn(state, p)

  const minHold = state.ball.lastTouchTeam === p.team && p.aiHoldTimer < 0.3 ? 0.25 : 0.3

  if (p.aiHoldTimer < minHold) return

  // Utility-based decision: every option the carrier has gets a score and the best one is taken.
  const options = carrierOptions(state, p, rng, { open, pressure, toGoal, goal, nearest })
  const best = options.reduce<CarrierOption | null>((b, o) => (!b || o.utility > b.utility ? o : b), null)
  p.aiDecision = best ? best.kind : 'carry'
  if (best) best.act(actions)
}

export type CarrierOptionKind =
  'shoot' | 'longShot' | 'direct' | 'through' | 'challenge' | 'progressive' | 'circulate' | 'fallback'

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
  const shootRange = attr(a.finishing, 9.5, 12.5)
  const angleOk = Math.abs(p.pos.x) < Math.abs(p.pos.y - c.goal.y) * 1.6 + 1
  const myValue = shotValue(state, p.team, p.pos, lane, c.pressure)

  // Shooting band (0.9+): in range with a lane, decided with the player's willingness to shoot.
  if (angleOk && c.toGoal < shootRange && (lane > 0.3 || c.toGoal < 8)) {
    const chance = clamp(0.35 + (shootRange - c.toGoal) / shootRange + attr(a.decisions, 0, 0.2), 0, 0.95)
    if (rng.chance(chance)) {
      // Close in: a quick low placed shot into the corner; further out: a firmer, slightly higher shot.
      const power = c.toGoal < 7.5 ? 0.3 : clamp(0.42 + (c.toGoal - 7.5) / 25, 0.42, 0.68)
      out.push({
        kind: 'shoot',
        utility: 0.9 + myValue * 0.1,
        act: (x) => x.shoot(p, sub(c.goal, p.pos), power),
      })
    }
  } else if (angleOk && c.toGoal < 15 && lane > 1.2 && rng.chance(attr(a.shotPower, 0.008, 0.025))) {
    // Occasional long-range attempt through an open lane.
    out.push({ kind: 'longShot', utility: 0.88, act: (x) => x.shoot(p, sub(c.goal, p.pos), 0.7) })
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

  // Keep the ball moving: carry it while there is space, then circulate (back / across).
  const circulateAfter = c.open ? attr(a.creativity, 1.6, 2.4) : attr(a.decisions, 1.0, 0.55)
  if (c.pressure > 0.45 || p.aiHoldTimer > circulateAfter) {
    const safe = safePassOption(state, p, c.pressure, rng)
    if (safe)
      out.push({ kind: 'circulate', utility: 0.4, act: (x) => x.pass(p, sub(safe.pos, p.pos), false, safe) })
    else {
      // Nothing safe: under heavy pressure or after holding too long, the best available option.
      const fallback = bestPassOption(state, p, rng)
      if (fallback && (c.pressure > 0.7 || p.aiHoldTimer > attr(a.creativity, 2.6, 3.4)))
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
