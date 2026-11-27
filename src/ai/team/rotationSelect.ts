/**
 * Rotation selection (utility AI): every plausible plan from the planners is scored with normalised
 * factors and compared with a "keep the current shape" candidate; the best plan starts only if it
 * beats keeping the shape. Weights depend on the team settings, the score and time, the observed
 * defending of the opponent and the formation profile. Deterministic: no random numbers, ties broken
 * by planner order.
 */
import { clamp } from '../../core/math/scalar'
import { dist } from '../../core/math/vec2'
import { laneOpenness } from '../../physics/PassingPhysics'
import type { MatchState, PlayerState, TeamId } from '../../simulation/MatchState'
import { passInterceptable } from '../passing'
import { shotValueAt } from './rotationValue'
import { FAMILIES, KIND_FAMILY, s01, type FamilyId, type MovementKind } from './rotationLibrary'
import type { Plan } from './rotationPlanners'
import type { RotationTeamState } from './rotationState'
import {
  balanceScore,
  carrierOf,
  depthToGoal,
  markerOf,
  matchProgress,
  outfield,
  spaceAt,
  styleOf,
} from './rotationSupport'

export interface Factors {
  space: number
  penetration: number
  lanes: number
  displacement: number
  suitability: number
  support: number
  numbers: number
  scoring: number
  interception: number
  congestion: number
  transition: number
  stamina: number
  repetition: number
  coordination: number
}

export interface Scored {
  plan: Plan
  score: number
  factors: Factors
}

/** Selection constants (tunable game-design values, not coaching rules). */
export const SELECT = {
  /** Seconds between team selections (about 5 Hz); a pass triggers one at once. */
  interval: 0.2,
  /** A combination replacing a rotation in progress must beat it by this much (hysteresis). */
  replaceMargin: 0.12,
  /** Repetition window (s). */
  repeatWindow: 15,
  /** A rotation of the formation (its normal movement) starts unless keeping still beats it by this. */
  patternContinuity: 0.15,
} as const

/** Families families get a small bonus against what the opponent shows (observed, not read from settings). */
const AGAINST_HIGH_PRESS: readonly FamilyId[] = [
  'thirdMan',
  'wallPass',
  'switchPlay',
  'diagonalRun',
  'paralela',
]
const AGAINST_LOW_BLOCK: readonly FamilyId[] = [
  'betweenLines',
  'wideOverload',
  'switchPlay',
  'doubleCut',
  'backPost',
]
const AGAINST_MAN: readonly FamilyId[] = [
  'wingClearance',
  'isolation',
  'crossRun',
  'oppositeMove',
  'diagonalRotation',
]
const AGAINST_ZONAL: readonly FamilyId[] = ['wideOverload', 'switchPlay', 'thirdMan', 'betweenLines']

const RUN_JOBS = new Set(['run', 'post'])

function avgAttr(p: PlayerState): number {
  const a = p.profile.attributes
  return (a.anticipation + a.tacticalIntelligence + a.acceleration + a.decisions) / 400
}

/** Normalised factors of a plan (0..1 each). */
export function planFactors(state: MatchState, team: TeamId, plan: Plan, rt: RotationTeamState): Factors {
  const c = state.players[plan.carrierId]!
  // Isolation has no runner: its value is the carrier's own way past his man (4 m on towards goal).
  const dirY = state.teams[team].attackDir
  const runs =
    plan.kind === 'isolation'
      ? [{ id: c.id, job: 'run' as const, target: { x: c.pos.x * 0.8, y: c.pos.y + dirY * 4 } }]
      : plan.moves.filter((m) => RUN_JOBS.has(m.job))
  const movers = plan.moves.map((m) => state.players[m.id]!)
  const fam = FAMILIES[KIND_FAMILY[plan.kind]]
  const st = styleOf(state, team)
  let space = 0
  let pen = 0
  let lanes = 0
  let scoring = 0
  let disp = 0
  let stamina = 0
  const closeMarker = markerOf(state, c, 2.6)
  for (const m of runs) {
    const p = state.players[m.id]!
    space += clamp(spaceAt(state, team, m.target) / 5, 0, 1)
    pen += clamp((depthToGoal(state, team, p.pos) - depthToGoal(state, team, m.target)) / 8, 0, 1)
    let lane = clamp(laneOpenness(state, team, c.pos, m.target) / 2, 0, 1)
    // The carrier's own marker does not shut a run that goes round him (the ball is released as
    // the runner gets past him): a lane clear of everybody else counts as fairly open.
    if (
      lane < 0.6 &&
      closeMarker >= 0 &&
      !passInterceptable(state, team, c.pos, m.target, 0.12, (o) => o.id === closeMarker)
    )
      lane = 0.6
    lanes = Math.max(lanes, lane)
    scoring = Math.max(scoring, clamp(shotValueAt(state, team, m.target) / 0.45, 0, 1))
    stamina += clamp(dist(p.pos, m.target) / 25, 0, 1) * (1.2 - p.stamina)
  }
  // Isolation: the carrier's own way past his man counts only as far as he is likely to win the
  // 1 v 1 (his dribbling against the defender's tackling).
  if (plan.kind === 'isolation') {
    const def = state.players
      .filter((o) => o.team !== team && o.role !== 'GK')
      .reduce<PlayerState | null>((a, o) => (!a || dist(o.pos, c.pos) < dist(a.pos, c.pos) ? o : a), null)
    const win = def
      ? clamp((c.profile.attributes.dribbling - def.profile.attributes.tackling) / 60 + 0.35, 0.1, 0.8)
      : 0.8
    pen *= win
    scoring *= win
    lanes = win
  }
  const n = Math.max(1, runs.length)
  // Decoy value: every marked mover (runner, the pivot coming short, a man clearing a space) pulls
  // his man along when the opponent marks man to man.
  const shifting = plan.moves.filter(
    (m) => m.job !== 'carry' && m.job !== 'switch' && m.job !== 'link' && m.job !== 'wall',
  )
  for (const m of shifting) if (markerOf(state, state.players[m.id]!, 3) >= 0) disp += 1
  const displacement = (disp / Math.max(1, shifting.length)) * (0.4 + 0.6 * rt.read.follow)
  // Support: teammates outside the runs still offering a safe ball to the carrier.
  const runIds = runs.map((m) => m.id)
  let safe = 0
  for (const q of outfield(state, team)) {
    if (q.id === c.id || runIds.includes(q.id)) continue
    if (laneOpenness(state, team, c.pos, q.pos) > 1 && !passInterceptable(state, team, c.pos, q.pos)) safe++
  }
  // Local numbers round the ball.
  let att = 0
  let def = 0
  for (const p of state.players) {
    if (p.role === 'GK' || dist(p.pos, state.ball.pos) > 8) continue
    if (p.team === team) att++
    else def++
  }
  // Congestion: a target close to a teammate not in the move, another target or a reserved space.
  let cong = 0
  for (const m of plan.moves) {
    if (m.job === 'carry' || m.job === 'switch' || m.job === 'link' || m.job === 'wall') continue
    for (const q of outfield(state, team))
      if (!plan.moves.some((x) => x.id === q.id) && q.id !== c.id && dist(q.pos, m.target) < 2.5) cong += 0.5
    for (const o of plan.moves) if (o !== m && dist(o.target, m.target) < 2.5) cong += 0.5
    for (const r of rt.reservations)
      if (r.playerId !== m.id && dist(r.center, m.target) < r.radius) cong += 0.3
  }
  const busy = [c.id, ...runIds]
  const transition = 1 - balanceScore(state, team, c.pos.y, busy)
  const recent = rt.recent.filter(
    (r) => r.family === KIND_FAMILY[plan.kind] && state.time - r.time < SELECT.repeatWindow,
  ).length
  const repetition = clamp(recent * (fam.type === 'pattern' ? 0.08 : 0.35), 0, 1)
  return {
    space: space / n,
    penetration: pen / n,
    lanes,
    displacement,
    suitability: movers.length ? movers.reduce((s, p) => s + avgAttr(p), 0) / movers.length : 0.5,
    support: clamp(safe / 2, 0, 1),
    numbers: clamp(0.5 + (att - def) * 0.25, 0, 1),
    scoring,
    interception: clamp(1 - lanes + fam.risk * 0.5, 0, 1),
    congestion: clamp(cong, 0, 1),
    transition,
    stamina: clamp(stamina / n, 0, 1),
    repetition,
    coordination: fam.coordination * (1 - s01(st.familiarity)),
  }
}

/** Utility of a plan (higher is better; compare with stayScore). */
export function scorePlan(state: MatchState, team: TeamId, plan: Plan, rt: RotationTeamState): Scored {
  const f = planFactors(state, team, plan, rt)
  const st = styleOf(state, team)
  const famId = KIND_FAMILY[plan.kind]
  const fam = FAMILIES[famId]
  const tac = state.teams[team].tactics
  const pen = s01(st.penetration)
  const risk = s01(st.passingRisk)
  const bal = s01(st.balance)
  const disc = s01(st.discipline)
  const pat = s01(st.patience)
  const opp = (1 - team) as TeamId
  const diff = state.score[team] - state.score[opp]
  const late = matchProgress(state) > 0.8
  const chase = late && diff < 0 ? 1.3 : 1
  const protect = late && diff > 0 ? 1.4 : late && diff < 0 ? 0.6 : 1
  const highPress = rt.read.block > 0.62
  const lowBlock = rt.read.block < 0.38
  const w = {
    space: 0.5,
    penetration: 0.6 * (0.5 + pen) * chase,
    lanes: 0.5,
    displacement: 0.25,
    suitability: 0.2,
    support: 0.3,
    numbers: 0.2,
    scoring: 0.6 * (0.5 + pen) * chase,
    interception: 0.5 * (1.5 - risk) * (highPress ? 1.3 : 1),
    congestion: 0.4 * (0.7 + 0.6 * disc),
    transition: 0.6 * (0.5 + bal) * protect,
    stamina: 0.15,
    repetition: 0.5,
    coordination: 0.4,
  }
  const gain =
    w.space * f.space +
    w.penetration * f.penetration +
    w.lanes * f.lanes +
    w.displacement * f.displacement +
    w.suitability * f.suitability +
    w.support * f.support +
    w.numbers * f.numbers +
    w.scoring * f.scoring
  const cost =
    w.interception * f.interception +
    w.congestion * f.congestion +
    w.transition * f.transition +
    w.stamina * f.stamina +
    w.repetition * f.repetition +
    w.coordination * f.coordination
  let score = (gain - cost) / 2.5
  // Formation profile (stronger with discipline; freedom softens moves from other formations).
  const profile = fam.formations[tac.formation]
  score += (profile - 1) * (0.25 + 0.35 * disc) * (profile < 1 ? 1.2 - s01(st.freedom) * 0.6 : 1)
  // Patience: the formation's rotations over quick combinations.
  score += (pat - 0.5) * (fam.type === 'pattern' ? 0.16 : -0.08)
  // Against what the opponent has shown.
  if (highPress && AGAINST_HIGH_PRESS.includes(famId)) score += 0.06
  if (lowBlock && AGAINST_LOW_BLOCK.includes(famId)) score += 0.06
  if (rt.read.follow > 0.6 && AGAINST_MAN.includes(famId)) score += 0.06
  if (rt.read.follow < 0.4 && AGAINST_ZONAL.includes(famId)) score += 0.06
  const prio = tac.priorities?.[famId] ?? 'normal'
  if (prio === 'low') score -= 0.12
  if (prio === 'high') score += 0.12
  return { plan, score, factors: f }
}

/**
 * Keeping the current shape: worth more when the carrier already has safe options and the team
 * plays at a low rotation frequency; worth less when chasing the game.
 */
export function stayScore(state: MatchState, team: TeamId): number {
  const st = styleOf(state, team)
  const c = carrierOf(state, team)
  let options = 0
  if (c)
    for (const q of outfield(state, team))
      if (
        q.id !== c.id &&
        laneOpenness(state, team, c.pos, q.pos) > 1 &&
        !passInterceptable(state, team, c.pos, q.pos)
      )
        options++
  const opp = (1 - team) as TeamId
  const chasing = matchProgress(state) > 0.8 && state.score[team] < state.score[opp] ? 0.06 : 0
  return 0.16 + (0.5 - s01(st.frequency)) * 0.4 + clamp(options / 3, 0, 1) * 0.1 - chasing
}

/** A family may be selected now (priority, family cooldown, numbers). */
export function familyAllowed(
  state: MatchState,
  team: TeamId,
  kind: MovementKind,
  rt: RotationTeamState,
): boolean {
  const famId = KIND_FAMILY[kind]
  const tac = state.teams[team].tactics
  if ((tac.priorities?.[famId] ?? 'normal') === 'off') return false
  if ((rt.familyReadyAt[famId] ?? 0) > state.time) return false
  // Short of players (a dismissal later on): no risky moves.
  const ours = outfield(state, team).length
  const theirs = outfield(state, (1 - team) as TeamId).length
  if (ours < theirs && FAMILIES[famId].risk >= 0.3) return false
  return true
}

/** Score every plan the planners give; best first. Plans with the human as a mover are dropped. */
export function rankPlans(
  state: MatchState,
  team: TeamId,
  planners: readonly ((s: MatchState, t: TeamId) => Plan | null)[],
  rt: RotationTeamState,
): Scored[] {
  const out: Scored[] = []
  for (const planner of planners) {
    const plan = planner(state, team)
    if (!plan || !familyAllowed(state, team, plan.kind, rt)) continue
    if (plan.moves.some((m) => m.id === state.controlledId)) continue
    out.push(scorePlan(state, team, plan, rt))
  }
  // Stable: equal scores keep planner order.
  return out.sort((a, b) => b.score - a.score)
}
