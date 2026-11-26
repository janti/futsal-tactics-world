/** Team defending: ball winner, cover defender, diamond marking, 2 v 1, transitions. */
import { clamp } from '../../core/math/scalar'
import { addScaled, closestOnSegment, dist, len, normalize, sub, type Vec2 } from '../../core/math/vec2'
import { estimateTimeToReach } from '../../physics/PlayerPhysics'
import type { MatchState, PlayerState, TeamId } from '../../simulation/MatchState'
import { COURT } from '../../simulation/SimulationConfig'
import { diamondAnchor } from '../positioning/Formation'
import { RECOVER_TIME } from '../common'

/**
 * Anti-ball-chasing: at most one player per team goes for the ball (loose ball or pressing the
 * carrier). On the human team the AI only takes this role when the human player is clearly slower.
 */
export function pickBallWinner(state: MatchState, team: TeamId): number | null {
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
  // 2 v 1: the last defender does not rush the carrier (he covers the pass, see twoVersusOne); a
  // teammate chasing from behind may press.
  const outnumbered = twoVersusOne(state, team)
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
    if (outnumbered && p.id === outnumbered.defender.id) continue
    if (p.role === 'FIXO' && owner && dist(target, ownGoal) < 16 && fixoHasMan(state, p, owner.id)) t += 0.8
    // The pivot holds the middle and his man; the alas press the carrier. Only a carrier with his
    // back to our goal (facing his own) is the pivot's to press: he closes the pass back.
    if (p.role === 'PIVOT' && owner) t += carrierBackToGoal(state, owner) ? -0.3 : 1.4
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

/** The carrier faces his own goal (back to the goal he attacks): he can only play it back. */
export function carrierBackToGoal(state: MatchState, owner: PlayerState): boolean {
  return Math.sin(owner.facing) * state.teams[owner.team].attackDir < -0.45
}

/**
 * Defending: every defender outside the press has one opponent to mark, chosen so that each
 * opponent is picked up by the defender whose diamond position is nearest (one-to-one). He stands
 * goal-side of his man, a little towards the ball, without leaving his zone of the diamond.
 */
export function markingPosition(state: MatchState, p: PlayerState, pressing: (number | null)[]): Vec2 {
  const dir = state.teams[p.team].attackDir
  const ball = state.ball.pos
  const anchor = diamondAnchor(p.role, dir, ball, state.teams[p.team].tactics)
  const man = markingAssignment(state, p.team, pressing).get(p.id)
  p.aiMarkId = man ?? null
  if (man === undefined) return anchor
  const a = state.players[man]!
  const ownGoal = { x: 0, y: -dir * COURT.halfLength }
  const height = state.teams[p.team].tactics.pressing
  // Their pivot (their furthest man up) is marked tight wherever the ball is: the pass into him is the
  // one to stop (diamond; the box marks as usual).
  const owner = state.ball.ownerId !== null ? state.players[state.ball.ownerId]! : null
  const isPivot =
    state.teams[p.team].tactics.formation !== '2-2' &&
    owner !== null &&
    owner.team !== p.team &&
    opponentPivot(state, p.team, owner)?.id === a.id
  // Tighter the closer he is to goal and to the ball; looser far away (still goal-side). A high press
  // marks tight everywhere.
  const tight = isPivot
    ? 1.1
    : height === 'high'
      ? clamp(0.8 + (dist(a.pos, ball) - 6) / 30, 0.8, 1.4)
      : clamp(1 + (dist(a.pos, ownGoal) - 8) / 14 + (dist(a.pos, ball) - 6) / 20, 1, 2.2)
  const goalSide = addScaled(a.pos, normalize(sub(ownGoal, a.pos)), tight)
  // Inside shoulder: cover the middle side of the man (and a touch towards the ball).
  const inside = { x: -Math.sign(a.pos.x) * Math.min(0.8, Math.abs(a.pos.x) * 0.3), y: 0 }
  let mark = addScaled({ x: goalSide.x + inside.x, y: goalSide.y }, normalize(sub(ball, goalSide)), 0.15)
  // Help side: a man far from the ball is marked loosely, sagging towards the middle in front of goal
  // so the defender can cover a carrier who gets through.
  const away = isPivot ? 0 : clamp((dist(a.pos, ball) - 7) / 10, 0, height === 'high' ? 0.2 : 0.45)
  const middle = { x: a.pos.x * 0.3, y: (a.pos.y + ownGoal.y) / 2 }
  mark = { x: mark.x + (middle.x - mark.x) * away, y: mark.y + (middle.y - mark.y) * away }
  mark = denyPivotLane(state, p, a, mark)
  // A man in front of our goal is followed even outside the zone.
  if (dist(a.pos, ownGoal) < 9) return mark
  const off = sub(mark, anchor)
  // The fixo guards the middle and leaves his zone least. A man between the ball and our goal is
  // dangerous: he is followed further out of the zone.
  const ahead = dist(a.pos, ownGoal) < dist(ball, ownGoal)
  // A low block does not follow men up the court out of the block; a high press follows them further.
  const zone =
    (p.role === 'FIXO' ? 4 : p.role === 'PIVOT' ? 6.5 : 5.5) +
    (ahead ? 3 : 0) +
    (height === 'low' ? -2 : height === 'high' ? 3 : 0)
  const l = len(off)
  const pos = l > zone ? addScaled(anchor, off, zone / l) : mark
  // The pivot keeps the middle closed: he does not follow the ball or his man out to the wings.
  // (A man between the ball and our goal is dangerous: him he follows out wide.)
  if (p.role === 'PIVOT' && !ahead) return { x: clamp(pos.x, -3.5, 3.5), y: pos.y }
  // An ala keeps his side of the diamond: at most a couple of metres over the middle.
  if (p.role === 'ALA_L' || p.role === 'ALA_R') {
    const ownSide = p.role === 'ALA_L' ? dir : -dir
    if (-ownSide * pos.x > 2) return { x: -ownSide * 2, y: pos.y }
  }
  return pos
}

/**
 * Diamond defence: shut the pass into their pivot (their most advanced player) while marking. The
 * pivot's own marker fronts him a little on the ball side; the others, unless their man is the
 * carrier's immediate option, lean off their man into the line from the ball to the pivot — the
 * defensive pivot (top of the diamond) most. They stay within reach of their man, so when the ball
 * is moved across the line has to be shut again, and in that moment the pass into the pivot (in the
 * middle or out on the wing) can open.
 */
/** Their pivot: the opponent (not the carrier) nearest our goal, clearly ahead of the ball; or null. */
export function opponentPivot(state: MatchState, team: TeamId, owner: PlayerState): PlayerState | null {
  const ownGoal = { x: 0, y: -state.teams[team].attackDir * COURT.halfLength }
  let pivot: PlayerState | null = null
  for (const o of state.players) {
    if (o.team === team || o.role === 'GK' || o.id === owner.id) continue
    if (!pivot || dist(o.pos, ownGoal) < dist(pivot.pos, ownGoal)) pivot = o
  }
  if (!pivot || dist(owner.pos, ownGoal) - dist(pivot.pos, ownGoal) < 4) return null
  return pivot
}

function denyPivotLane(state: MatchState, p: PlayerState, man: PlayerState, mark: Vec2): Vec2 {
  if (state.teams[p.team].tactics.formation === '2-2') return mark
  const owner = state.ball.ownerId !== null ? state.players[state.ball.ownerId]! : null
  if (!owner || owner.team === p.team || owner.role === 'GK') return mark
  const pivot = opponentPivot(state, p.team, owner)
  if (!pivot) return mark
  if (man.id === pivot.id) {
    // Front him a little on the ball side (still goal-side of him).
    return addScaled(mark, normalize(sub(owner.pos, man.pos)), 0.45)
  }
  // His own man close to the ball is the carrier's first option: mark him, do not leave him.
  if (dist(man.pos, owner.pos) < 3) return mark
  const { point, t } = closestOnSegment(owner.pos, pivot.pos, mark)
  if (t < 0.15 || t > 0.85) return mark
  const gap = dist(point, mark)
  if (gap < 0.05 || gap > 7) return mark
  const weight = p.role === 'PIVOT' ? 1 : 0.75
  // A man of his ahead of the ball (between it and our goal) and close to it is a threat himself:
  // only a small lean off him then.
  const ownGoal = { x: 0, y: -state.teams[p.team].attackDir * COURT.halfLength }
  const threat = dist(man.pos, ownGoal) < dist(owner.pos, ownGoal) && dist(man.pos, owner.pos) < 8.5
  let out = addScaled(mark, normalize(sub(point, mark)), Math.min(threat ? 0.8 : 1.8, gap * 0.6) * weight)
  // Never so far off that his man is free: within 3.5 m of him.
  const fromMan = dist(out, man.pos)
  if (fromMan > 3.5) out = addScaled(man.pos, normalize(sub(out, man.pos)), 3.5)
  return out
}

/**
 * 2 v 1 tuning (distances of the carrier from our goal, metres). Far out the last defender covers the
 * passing lane to the second attacker instead of rushing the carrier; from `closeFrom` in he moves
 * closer to the carrier the nearer they get, standing goal-side of him by `coverDistance` (3-4 m outside
 * the penalty-area arc); from `markDistance` (the arc or a couple of metres before it) he marks the
 * second attacker and the keeper comes out to the arc to block the shot.
 */
export const TWO_V_ONE = {
  /** From here in, the cover moves gradually from the passing lane towards the carrier. */
  closeFrom: 16,
  coverDistance: 9.8,
  markDistance: 8,
  maxDistance: 20,
} as const

export interface TwoVersusOne {
  defender: PlayerState
  carrier: PlayerState
  mate: PlayerState
  carrierToGoal: number
}

/**
 * Outnumbered near our goal: an opponent carries the ball within 20 m, exactly one of our outfield
 * players is goal-side of him and a second attacker is level or ahead of the ball close by.
 */
export function twoVersusOne(state: MatchState, team: TeamId): TwoVersusOne | null {
  if (state.phase !== 'play') return null
  const ball = state.ball
  const carrier = ball.ownerId !== null ? state.players[ball.ownerId]! : null
  if (!carrier || carrier.team === team || carrier.role === 'GK' || ball.inHands) return null
  const ownGoal = { x: 0, y: -state.teams[team].attackDir * COURT.halfLength }
  const carrierToGoal = dist(carrier.pos, ownGoal)
  if (carrierToGoal > TWO_V_ONE.maxDistance) return null
  const goalSide = state.players.filter(
    (q) => q.team === team && q.role !== 'GK' && dist(q.pos, ownGoal) < carrierToGoal + 0.4,
  )
  if (goalSide.length !== 1) return null
  let mate: PlayerState | null = null
  for (const m of state.players) {
    if (m.team !== carrier.team || m.id === carrier.id || m.role === 'GK') continue
    if (dist(m.pos, ownGoal) > carrierToGoal + 3 || dist(m.pos, carrier.pos) > 12) continue
    if (!mate || dist(m.pos, ownGoal) < dist(mate.pos, ownGoal)) mate = m
  }
  if (!mate) return null
  return { defender: goalSide[0]!, carrier, mate, carrierToGoal }
}

/** Where the lone defender stands in a 2 v 1 (see TWO_V_ONE). */
export function twoVersusOneSpot(state: MatchState, s: TwoVersusOne): Vec2 {
  const team = s.defender.team
  const ownGoal = { x: 0, y: -state.teams[team].attackDir * COURT.halfLength }
  // At the arc: mark the second attacker, goal-side and a little towards the ball.
  if (s.carrierToGoal <= TWO_V_ONE.markDistance) {
    const gs = addScaled(s.mate.pos, normalize(sub(ownGoal, s.mate.pos)), 0.8)
    return addScaled(gs, normalize(sub(s.carrier.pos, gs)), 0.4)
  }
  // Further out: in the passing lane to the second attacker (a little goal-side of it), not on the ball.
  const lanePoint = {
    x: s.carrier.pos.x + (s.mate.pos.x - s.carrier.pos.x) * 0.45,
    y: s.carrier.pos.y + (s.mate.pos.y - s.carrier.pos.y) * 0.45,
  }
  const cover = addScaled(lanePoint, normalize(sub(ownGoal, lanePoint)), 0.8)
  // Closing in: the nearer the carrier gets to the arc, the closer to him (goal-side) he stands.
  const onBall = addScaled(s.carrier.pos, normalize(sub(ownGoal, s.carrier.pos)), 1.6)
  const k = clamp(
    (TWO_V_ONE.closeFrom - s.carrierToGoal) / (TWO_V_ONE.closeFrom - TWO_V_ONE.coverDistance),
    0,
    1,
  )
  return { x: cover.x + (onBall.x - cover.x) * k, y: cover.y + (onBall.y - cover.y) * k }
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
  const anchors = defenders.map((d) => diamondAnchor(d.role, dir, ball, state.teams[team].tactics))
  // Cost of a pairing: distance from the defender's diamond spot to the man. An ala keeps to his own
  // side (a man on the far side costs extra: he does not run across the court after him), and a
  // pairing that already exists is kept unless another is clearly better (no swapping men to and fro).
  const pairCost = (i: number, j: number): number => {
    const d = defenders[i]!
    const o = attackers[j]!
    let c = dist(anchors[i]!, o.pos)
    if (d.role === 'ALA_L' || d.role === 'ALA_R') {
      // Team-relative side: ALA_L is on the negative lateral side, i.e. world x = +dir * |x|.
      const ownSide = d.role === 'ALA_L' ? dir : -dir
      const across = -ownSide * o.pos.x
      if (across > 1.5) c += 2 + (across - 1.5) * 1.2
    }
    if (d.aiMarkId === o.id) c -= 1.5
    return c
  }
  // Brute force over assignments (at most 4 x 4 = 24 permutations): minimum total cost.
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
      rec(i + 1, cost + pairCost(i, j))
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
    if (state.aiPrevPossession !== state.possessionTeam) {
      state.defTransition[team] = goalSide < 2
      // Ball lost: everybody switches to defending at once (no waiting for the next decision tick)
      // and sprints back into shape for a moment.
      for (const p of state.players) {
        if (p.team !== team || p.role === 'GK') continue
        p.aiDecisionTimer = 0
        p.aiRecoverTimer = RECOVER_TIME
        p.aiRunTimer = 0
      }
    }
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
  // A second man goes to the ball only in our own half (also in a counter-attack against us: further
  // up the court the others stay with their men or recover into shape instead).
  if (carrierToGoal > 20) return null
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
    if (twoVersusOne(state, team)?.defender.id === d.id) continue
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
