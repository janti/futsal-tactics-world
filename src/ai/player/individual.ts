/**
 * Individual off-ball movements of the rotation library (no team slot): the V-cut (lose a tight
 * marker with a step away and a burst into the receiving spot) and between-the-lines movement (find a
 * pocket inside the block, out of the cover shadows). They only adjust a support player's target and
 * respect the team move's jobs and reservations; the human player is never moved.
 */
import { closestOnSegment, dist, normalize, sub, type Vec2 } from '../../core/math/vec2'
import { laneOpenness } from '../../physics/PassingPhysics'
import type { MatchState, PlayerState } from '../../simulation/MatchState'
import { familyAllowed } from '../team/rotationSelect'
import { s01 } from '../team/rotationLibrary'
import { recordIndividual, reservedAt, rotationMove } from '../team/rotations'
import { deepestOf, depthToGoal, inCourt, markerOf, spaceAt, styleOf } from '../team/rotationSupport'

export const INDIVIDUAL = {
  /** V-cut: the step away (s) and the burst (s). */
  vStep: 0.45,
  vBurst: 1,
  /** Metres of the step away. */
  vStepLength: 1.5,
  /** Between the lines: how far from the support spot a pocket may be (m). */
  pocketRadius: 3,
} as const

/**
 * The target for a support player this decision, if an individual movement applies (else null).
 * `spot` is where the team shape wants him. Also keeps the movement's statistics.
 */
export function individualTarget(state: MatchState, p: PlayerState, spot: Vec2): Vec2 | null {
  const owner = state.ball.ownerId !== null ? state.players[state.ball.ownerId]! : null
  const mv = p.aiMove
  if (mv) {
    if (
      !owner ||
      owner.team !== p.team ||
      owner.id === p.id ||
      state.time > mv.until ||
      rotationMove(state, p)
    ) {
      if (!mv.received && mv.kind === 'vCut' && state.time <= mv.until)
        recordIndividual(state, p.team, 'vCut', 'cancelled')
      p.aiMove = null
      return null
    }
    if (mv.kind === 'vCut') return vCutStep(state, p)
    return mv.spot
  }
  if (!owner || owner.team !== p.team || owner.id === p.id || owner.role === 'GK') return null
  if (!state.teams[p.team].tactics.rotations || p.id === state.controlledId) return null
  if (state.time < p.aiMoveReadyAt) return null
  // Freedom: how often an eligible player actually goes for it (a deterministic per-tick draw).
  const draw = ((state.tick * 7919 + p.id * 104729) % 1000) / 1000
  if (draw > 0.25 + 0.65 * s01(styleOf(state, p.team).freedom)) return null
  return startVCut(state, p, owner, spot) ?? startBetweenLines(state, p, owner, spot)
}

function startVCut(state: MatchState, p: PlayerState, owner: PlayerState, spot: Vec2): Vec2 | null {
  if (!familyAllowed(state, p.team, 'vCut', state.rotationTeam[p.team])) return null
  const d = dist(p.pos, owner.pos)
  if (d < 4 || d > 14) return null
  // Not the deepest man (he is the safe ball back and the balance), nor a player behind the ball.
  const dir = state.teams[p.team].attackDir
  if ((p.pos.y - owner.pos.y) * dir < -1 || deepestOf(state, p.team)?.id === p.id) return null
  // Marked tight, and the carrier could find him at the spot (otherwise the V-cut is wasted running).
  // More freedom: a V-cut already against a marker a little further off.
  const mk = markerOf(state, p, 1.3 + s01(styleOf(state, p.team).freedom) * 0.8)
  if (mk < 0 || laneOpenness(state, p.team, owner.pos, spot) < 1) return null
  const away = normalize(sub(p.pos, spot))
  if (Math.hypot(away.x, away.y) < 0.5) return null
  const fake = inCourt({
    x: p.pos.x + away.x * INDIVIDUAL.vStepLength,
    y: p.pos.y + away.y * INDIVIDUAL.vStepLength,
  })
  p.aiMove = {
    kind: 'vCut',
    phase: 0,
    until: state.time + INDIVIDUAL.vStep + INDIVIDUAL.vBurst,
    spot: { ...spot },
    fake,
    markerId: mk,
    markerDist: dist(state.players[mk]!.pos, p.pos),
    received: false,
  }
  // More freedom: more often.
  p.aiMoveReadyAt = state.time + 9 * (1.5 - s01(styleOf(state, p.team).freedom))
  recordIndividual(state, p.team, 'vCut', 'started')
  return fake
}

/**
 * The V-cut: the step away, then — reading the marker — the burst. A marker who went with the step
 * is left behind by the change of direction; one who stepped across into the receiving line makes
 * him check to the other side of him instead.
 */
function vCutStep(state: MatchState, p: PlayerState): Vec2 {
  const mv = p.aiMove!
  const start = mv.until - INDIVIDUAL.vStep - INDIVIDUAL.vBurst
  if (mv.phase === 0 && state.time - start < INDIVIDUAL.vStep) return mv.fake
  if (mv.phase === 0) {
    mv.phase = 1
    const m = state.players[mv.markerId]!
    // He anticipated (closer to the receiving spot than our man): check to the other side of him —
    // the spot turned 55 degrees round our man, away from the side the marker is on.
    if (dist(m.pos, mv.spot) < dist(p.pos, mv.spot) - 0.3) {
      const v = { x: mv.spot.x - p.pos.x, y: mv.spot.y - p.pos.y }
      const side = v.x * (m.pos.y - p.pos.y) - v.y * (m.pos.x - p.pos.x) > 0 ? -1 : 1
      const a = side * 0.96
      const r = { x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) }
      mv.spot = inCourt({ x: p.pos.x + r.x, y: p.pos.y + r.y })
    }
  }
  p.aiState = 'run'
  return mv.spot
}

/** A defender stands in the line from the carrier to `q` (q is in his cover shadow). */
function shadowed(state: MatchState, p: PlayerState, from: Vec2, q: Vec2): boolean {
  for (const o of state.players) {
    if (o.team === p.team || o.role === 'GK' || dist(o.pos, q) <= 1) continue
    if (dist(closestOnSegment(from, q, o.pos).point, o.pos) < 1.3) return true
  }
  return false
}

/**
 * Between the lines: a pocket near his spot that is visible from the carrier (no defender in the
 * cover shadow between them), with room, ideally with defenders both in front of and behind it.
 * Used most against zonal defending and a low or mid block.
 */
function startBetweenLines(state: MatchState, p: PlayerState, owner: PlayerState, spot: Vec2): Vec2 | null {
  const rt = state.rotationTeam[p.team]
  if (!familyAllowed(state, p.team, 'betweenLines', rt)) return null
  const dir = state.teams[p.team].attackDir
  const ahead = (p.pos.y - owner.pos.y) * dir
  const depth = depthToGoal(state, p.team, p.pos)
  if (ahead < 3 || ahead > 12 || depth < 5 || depth > 22) return null
  // A man-marking opponent who follows everyone leaves no pockets to wait in.
  const st = styleOf(state, p.team)
  if (rt.read.follow > 0.75 - s01(st.freedom) * 0.2) return null
  const score = (q: Vec2) => {
    let shadow = 0
    let front = 0
    let back = 0
    for (const o of state.players) {
      if (o.team === p.team || o.role === 'GK') continue
      const c = closestOnSegment(owner.pos, q, o.pos)
      if (dist(c.point, o.pos) < 1.3 && dist(o.pos, q) > 1) shadow = 2
      if (Math.abs(o.pos.x - q.x) < 6) {
        const rel = (o.pos.y - q.y) * dir
        if (rel > 0.8 && rel < 6) front++
        if (rel < -0.8 && rel > -6) back++
      }
    }
    return (
      Math.min(spaceAt(state, p.team, q), 4) +
      Math.min(laneOpenness(state, p.team, owner.pos, q), 3) * 0.8 -
      shadow +
      (front && back ? 1 : 0)
    )
  }
  const base = score(spot)
  let best: Vec2 | null = null
  let bestScore = base + 0.5
  for (const dx of [-1.5, 0, 1.5])
    for (const dy of [-1.5, 0, 1.5]) {
      if (dx === 0 && dy === 0) continue
      const q = inCourt({ x: spot.x + dx * 2, y: spot.y + dy * 2 * dir })
      if (dist(q, spot) > INDIVIDUAL.pocketRadius + 0.5 || reservedAt(state, p.team, q, p.id)) continue
      const v = score(q)
      // Never into a defender's cover shadow (the shadow already costs 2 in the score; here it rules out).
      if (shadowed(state, p, owner.pos, q)) continue
      if (v > bestScore) {
        bestScore = v
        best = q
      }
    }
  if (!best) return null
  p.aiMove = {
    kind: 'betweenLines',
    phase: 0,
    until: state.time + 1.5,
    spot: best,
    fake: best,
    markerId: -1,
    markerDist: 0,
    received: false,
  }
  p.aiMoveReadyAt = state.time + 1.5
  recordIndividual(state, p.team, 'betweenLines', 'started')
  return best
}
