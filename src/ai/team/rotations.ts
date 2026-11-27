/**
 * Attacking movement (Milestone 6): the runtime of the rotation library. One coordinated move per
 * team at a time (`state.rotation[team]`); individual movements (V-cut, between the lines) live in
 * offBall.ts and respect it.
 *
 * **Rotations** (patterns) are the continuous off-ball movement of a formation: the ball goes to a
 * side, a player moves up into space and the receiver looks for him (or the pivot); if nothing is
 * on, the ball goes to a side again and the next cycle starts. **Combinations** are two- to
 * four-man moves started where space opens. Definitions: rotationLibrary.ts; triggers and targets:
 * rotationPlanners.ts; choice against keeping the shape: rotationSelect.ts.
 *
 * Life of a move: selected (candidate -> preparing -> committed in one step: participants, targets,
 * reserved spaces, balance checked) -> `preparing` (a familiarity-dependent moment before the runs
 * go) -> `executing` -> `opportunity` (a runner free with an open lane) -> completed (the ball
 * reached a runner) or cancelled (time up, possession lost, the ball to somebody outside the move,
 * no space, the human took over a participant, tactics changed). Then the team recovers / cools
 * down; rotations flow straight on into the next cycle.
 *
 * The defenders are never told anything: the runtime only reads what they do (did the marker
 * follow the runner?) and branches on it.
 */
import { dist, type Vec2 } from '../../core/math/vec2'
import { clamp } from '../../core/math/scalar'
import { laneOpenness, predictPassTarget } from '../../physics/PassingPhysics'
import { shotValueAt } from './rotationValue'
import { estimateTimeToReach } from '../../physics/PlayerPhysics'
import type { MatchEvent } from '../../simulation/Events'
import type { MatchState, PlayerState, TeamId } from '../../simulation/MatchState'
import { passInterceptable } from '../passing'
import {
  FAMILIES,
  KIND_FAMILY,
  PATTERN_KINDS,
  s01,
  type IndividualKind,
  type PatternKind,
  type RotationKind,
} from './rotationLibrary'
import {
  COMBINATION_PLANNERS,
  PATTERN_PLANNERS,
  ROTATION_ZONE,
  justPassed,
  vacatedWing,
  backPostSpots,
  type Plan,
} from './rotationPlanners'
import { SELECT, rankPlans, stayScore, familyAllowed } from './rotationSelect'
import type { EndReason, Rotation, RotationMove, RotationStats, RotationTeamState } from './rotationState'
import {
  attackDir,
  balanceOk,
  defenderInFront,
  depthToGoal,
  free,
  inCourt,
  markerOf,
  movable,
  outfield,
  pathFree,
  pivotOf,
  spaceAt,
  styleOf,
} from './rotationSupport'

export type { PatternKind, CombinationKind, RotationKind, MovementKind } from './rotationLibrary'
export { PATTERN_KINDS, ROTATION_KINDS, MOVEMENT_KINDS } from './rotationLibrary'
export type { RotationJob, RotationMove, Rotation, RotationStats, EndReason } from './rotationState'
export { emptyRotationStats, emptyRotationTeam } from './rotationState'

/** A rotation of the formation (continuous off-ball movement), not a combination. */
export function isPattern(kind: RotationKind): kind is PatternKind {
  return (PATTERN_KINDS as readonly string[]).includes(kind)
}

export const ROTATION = {
  /** Seconds after a combination before the team starts another (at the default frequency). */
  cooldown: 2,
  /** Time limit per kind (seconds). */
  duration: {
    baseEight: 5.5,
    baseEightWing: 5.5,
    butterfly: 5.5,
    fourCircle: 5,
    threeCircle: 5.5,
    diagonalRotation: 5.5,
    parallelRotation: 5.5,
    wallPass: 2.2,
    overlap: 3,
    pivot: 2.8,
    backPost: 3.4,
    wingClearance: 3.5,
    crossRun: 4,
    paralela: 3,
    diagonalRun: 3,
    thirdMan: 3,
    underlap: 3,
    pivotLayoff: 2.5,
    doubleCut: 3,
    oppositeMove: 3,
    wideOverload: 4,
    switchPlay: 3,
    pisada: 1.5,
    isolation: 3,
  } satisfies Record<RotationKind, number>,
  /** Rotations happen between these distances (m) from the goal attacked (build-up and midcourt). */
  zone: ROTATION_ZONE,
  /** Back-post rotation: the men swap after this long without the ball across. */
  backPostSwap: 1.5,
  /** The defender response is read this long after the start (s). */
  responseAt: 1,
  /** Shots and goals this long after a move are credited to it (s). */
  creditWindow: 5,
} as const

/** The rotation move this player has (null if he is not part of an active rotation). */
export function rotationMove(state: MatchState, p: PlayerState): RotationMove | null {
  const r = state.rotation[p.team]
  if (!r) return null
  return r.moves.find((m) => m.id === p.id) ?? null
}

/** The run of this move has started (staggered runs wait for `startAt`). */
export function moveStarted(state: MatchState, m: RotationMove): boolean {
  return m.startAt === undefined || state.time >= m.startAt
}

type Emit = (e: MatchEvent) => void

/** Team-level selection details passed to startRotation (defaults for direct starts and tests). */
interface StartInfo {
  score?: number
  stay?: number
  trigger?: string
  rejected?: { kind: RotationKind; score: number }[]
}

export function startRotation(
  state: MatchState,
  team: TeamId,
  kind: RotationKind,
  carrierId: number,
  moves: RotationMove[],
  info: StartInfo = {},
  emit?: Emit,
): Rotation {
  const rt = state.rotationTeam[team]
  const st = styleOf(state, team)
  // Preparing: a moment before the runs go — shorter for a team that knows its moves and for
  // tactically sharp players; the passer of a rotation goes at once (his own pass is the cue).
  const pattern = isPattern(kind)
  for (const m of moves) {
    m.origin = { ...state.players[m.id]!.pos }
    if (m.job !== 'run' && m.job !== 'post') continue
    const p = state.players[m.id]!
    const delay =
      ((1 - s01(st.familiarity)) * 0.35 + (1 - p.profile.attributes.tacticalIntelligence / 100) * 0.2) *
      (pattern ? 0.3 : 1)
    if (delay > 0.05) m.startAt = Math.max(m.startAt ?? state.time, state.time + delay)
  }
  const preparing = moves.some((m) => m.startAt !== undefined && m.startAt > state.time)
  const r: Rotation = {
    kind,
    instance: rt.nextInstance++,
    carrierId,
    moves,
    started: state.time,
    until: state.time + ROTATION.duration[kind],
    swapped: false,
    wallTouched: false,
    status: preparing ? 'preparing' : 'executing',
    score: info.score ?? 0,
    stay: info.stay ?? 0,
    trigger: info.trigger ?? 'direct',
    markers: [],
    response: 'pending',
    branch: null,
    rejected: info.rejected ?? [],
    opportunityCounted: false,
    displacedCounted: false,
  }
  for (const m of moves) {
    if (m.job !== 'run' && m.job !== 'post') continue
    const p = state.players[m.id]!
    const mk = markerOf(state, p)
    if (mk >= 0) r.markers.push({ runner: m.id, marker: mk, from: { ...state.players[mk]!.pos } })
  }
  if (r.markers.length === 0) r.response = 'none'
  state.rotation[team] = r
  state.rotationStats[team][kind].started++
  const famId = KIND_FAMILY[kind]
  rt.recent.push({ family: famId, time: state.time })
  while (rt.recent.length > 12) rt.recent.shift()
  rt.phase = 'active'
  reserve(state, team, r)
  emit?.({ type: 'RotationStarted', tick: state.tick, team, kind, instance: r.instance, score: r.score })
  return r
}

function endRotation(
  state: MatchState,
  team: TeamId,
  completed: boolean,
  reason: EndReason,
  emit?: Emit,
): void {
  const r = state.rotation[team]
  if (!r) return
  const rt = state.rotationTeam[team]
  const stats = state.rotationStats[team][r.kind]
  if (completed) stats.completed++
  else stats.cancelled++
  stats.reasons[reason] = (stats.reasons[reason] ?? 0) + 1
  clearRuns(state, r)
  rt.reservations = rt.reservations.filter((x) => x.instance !== r.instance)
  state.rotation[team] = null
  const st = styleOf(state, team)
  const freq = 1.5 - s01(st.frequency)
  // A combination is followed by a pause (longer for a disciplined team that resets its shape); the
  // rotations flow straight on into the next cycle.
  const pause = isPattern(r.kind) ? 0 : ROTATION.cooldown * freq * (0.85 + s01(st.discipline) * 0.3)
  state.rotationReadyAt[team] = state.time + pause
  rt.phase = pause > 0 ? 'cooldown' : 'idle'
  rt.recoverUntil = state.time + pause
  const fam = FAMILIES[KIND_FAMILY[r.kind]]
  rt.familyReadyAt[fam.id] = state.time + fam.cooldown * freq
  rt.last = { kind: r.kind, reason, completed, time: state.time }
  rt.creditKind = r.kind
  rt.creditUntil = state.time + ROTATION.creditWindow
  emit?.({
    type: 'RotationEnded',
    tick: state.tick,
    team,
    kind: r.kind,
    instance: r.instance,
    completed,
    reason,
  })
}

/** The runs of a move end with it (a runner who did not get the ball goes back to the shape). */
function clearRuns(state: MatchState, r: Rotation): void {
  for (const m of r.moves) {
    const p = state.players[m.id]!
    if ((m.job === 'run' || m.job === 'post') && state.ball.ownerId !== p.id) p.aiRunTimer = 0
  }
}

// --------------------------------------------------------------------------- reservations

function reserve(state: MatchState, team: TeamId, r: Rotation): void {
  const rt = state.rotationTeam[team]
  for (const m of r.moves) {
    if (m.job === 'carry' || m.job === 'switch' || m.job === 'link' || m.job === 'wall') continue
    const p = state.players[m.id]!
    rt.reservations.push({
      playerId: m.id,
      instance: r.instance,
      purpose: m.job,
      center: { ...m.target },
      radius: 2.5,
      eta: (m.startAt ?? state.time) + estimateTimeToReach(p, m.target),
      until: r.until,
      priority: m.job === 'run' || m.job === 'post' ? 2 : 1,
    })
  }
}

/** A reserved space (of another player) contains `pos`; the reservation, or null. */
export function reservedAt(state: MatchState, team: TeamId, pos: Vec2, forId: number) {
  for (const r of state.rotationTeam[team].reservations)
    if (r.playerId !== forId && dist(r.center, pos) < r.radius) return r
  return null
}

/** Move a support target out of teammates' reserved spaces (the reservation steers, never blocks). */
export function avoidReserved(state: MatchState, p: PlayerState, target: Vec2): Vec2 {
  const res = reservedAt(state, p.team, target, p.id)
  if (!res) return target
  const dx = target.x - res.center.x
  const dy = target.y - res.center.y
  const d = Math.hypot(dx, dy) || 1
  const k = res.radius + 0.3
  return inCourt({ x: res.center.x + (dx / d) * k, y: res.center.y + (dy / d) * k })
}

// --------------------------------------------------------------------------- the update

function mayRotate(state: MatchState, team: TeamId): boolean {
  if (state.phase !== 'play' || state.possessionTeam !== team || state.clearance) return false
  if (!state.teams[team].tactics.rotations) return false
  const ph = state.teamPhase[team]
  return ph === 'attack' || ph === 'transitionAttack'
}

/** Start, advance and end rotations (once per tick, before the AI decisions). */
export function updateRotations(state: MatchState, emit?: Emit): void {
  for (const team of [0, 1] as const) {
    const rt = state.rotationTeam[team]
    trackOutcomes(state, team, rt)
    trackIndividual(state, team)
    updateDefenceRead(state, team, rt)
    rt.reservations = rt.reservations.filter((x) => x.until > state.time)
    if (rt.phase === 'cooldown' && state.time >= rt.recoverUntil) rt.phase = 'idle'
    const r = state.rotation[team]
    if (r) {
      if (state.phase !== 'play') {
        endRotation(state, team, false, 'ballDead', emit)
        continue
      }
      if (state.possessionTeam !== team) {
        // Possession really lost (a pass between teammates keeps the team in possession).
        state.rotationStats[team][r.kind].turnovers++
        rt.lossAt = state.time
        rt.lossKind = r.kind
        endRotation(state, team, false, 'possessionLost', emit)
        continue
      }
      if (!state.teams[team].tactics.rotations) {
        endRotation(state, team, false, 'tacticsChanged', emit)
        continue
      }
      // (Not while the pass to one of its runners is on its way: that pass decides the move.)
      const b = state.ball
      const passToMover =
        b.ownerId === null &&
        b.intendedReceiverId !== null &&
        r.moves.some((m) => m.id === b.intendedReceiverId)
      if (state.time > r.until && !passToMover) {
        endRotation(state, team, false, 'timeUp', emit)
        continue
      }
      if (!dropHumanMoves(state, team, r)) {
        endRotation(state, team, false, 'humanControl', emit)
        continue
      }
      if (r.status === 'preparing' && r.moves.every((m) => moveStarted(state, m))) r.status = 'executing'
      readResponse(state, team, r, emit)
      if (!state.rotation[team]) continue
      reassignTargets(state, team, r)
      updateOpportunity(state, team, r, emit)
      if (!isPattern(r.kind)) {
        advanceCombination(state, team, r, emit)
        continue
      }
      if (advancePattern(state, team, r, emit)) {
        // A combination may take over a rotation in progress where it clearly does better.
        maybeReplace(state, team, r, emit)
        continue
      }
      // The cycle ended with a pass: that pass may start the next cycle at once (below).
    }
    if (!mayRotate(state, team)) continue
    // The pause after a combination holds back combinations; the formation's rotation goes on.
    const comboReady = state.time >= state.rotationReadyAt[team]
    const passNow = justPassed(state, team) !== null
    if (!passNow && (!comboReady || state.time < rt.nextSelectAt)) continue
    if (comboReady) rt.nextSelectAt = state.time + SELECT.interval
    select(state, team, passNow, comboReady, emit)
  }
}

function select(state: MatchState, team: TeamId, passNow: boolean, comboReady: boolean, emit?: Emit): void {
  const rt = state.rotationTeam[team]
  const planners = [...(passNow ? PATTERN_PLANNERS : []), ...(comboReady ? COMBINATION_PLANNERS : [])]
  const ranked = rankPlans(state, team, planners, rt)
  const stay = stayScore(state, team)
  rt.lastEval = {
    time: state.time,
    stay,
    candidates: ranked.slice(0, 4).map((x) => ({ kind: x.plan.kind, score: x.score })),
  }
  const best = ranked[0]
  // The formation's rotation is its normal movement: it goes on unless keeping still is clearly
  // better (a continuity margin); a combination must beat keeping the shape outright.
  const bar = isPattern(best?.plan.kind ?? 'wallPass') ? stay - SELECT.patternContinuity : stay
  if (!best || best.score <= bar) return
  start(state, team, best.plan, best.score, stay, ranked, emit)
}

function start(
  state: MatchState,
  team: TeamId,
  plan: Plan,
  score: number,
  stay: number,
  ranked: { plan: Plan; score: number }[],
  emit?: Emit,
): void {
  startRotation(
    state,
    team,
    plan.kind,
    plan.carrierId,
    plan.moves,
    {
      score,
      stay,
      trigger: plan.trigger,
      rejected: ranked
        .filter((x) => x.plan !== plan)
        .slice(0, 3)
        .map((x) => ({ kind: x.plan.kind, score: x.score })),
    },
    emit,
  )
}

/** During a rotation, at the selection rate: a combination that beats it clearly takes over. */
function maybeReplace(state: MatchState, team: TeamId, r: Rotation, emit?: Emit): void {
  const rt = state.rotationTeam[team]
  if (state.time < rt.nextSelectAt) return
  rt.nextSelectAt = state.time + SELECT.interval
  const ranked = rankPlans(state, team, COMBINATION_PLANNERS, rt)
  const best = ranked[0]
  const stay = stayScore(state, team)
  if (!best || best.score <= Math.max(stay, r.score) + SELECT.replaceMargin) return
  // The rotation runs into the combination (not counted as a failure of either).
  const stats = state.rotationStats[team][r.kind]
  stats.reasons.replaced = (stats.reasons.replaced ?? 0) + 1
  clearRuns(state, r)
  rt.reservations = rt.reservations.filter((x) => x.instance !== r.instance)
  state.rotation[team] = null
  start(state, team, best.plan, best.score, stay, ranked, emit)
}

/**
 * The human player is never moved by a rotation: if control switched to a participant, his job is
 * dropped. Returns false when no run is left (the move is over).
 */
function dropHumanMoves(state: MatchState, team: TeamId, r: Rotation): boolean {
  const human = state.controlledId
  if (human === null || state.humanTeam !== team) return true
  if (!r.moves.some((m) => m.id === human)) return true
  r.moves = r.moves.filter((m) => m.id !== human)
  state.rotationTeam[team].reservations = state.rotationTeam[team].reservations.filter(
    (x) => x.playerId !== human,
  )
  return r.moves.some((m) => m.job === 'run' || m.job === 'post' || m.job === 'drop')
}

// ------------------------------------------------------------------- defenders and space

/** About a second in: what did the runners' markers do? Branches react to it. */
function readResponse(state: MatchState, team: TeamId, r: Rotation, emit?: Emit): void {
  if (r.response !== 'pending' || state.time - r.started < ROTATION.responseAt) return
  const first = r.markers[0]!
  const runner = state.players[first.runner]!
  const marker = state.players[first.marker]!
  if (dist(marker.pos, runner.pos) < 2.8) r.response = 'followed'
  else if (dist(marker.pos, first.from) < 2) r.response = 'held'
  else if (markerOf(state, runner, 2.5) >= 0) r.response = 'handedOver'
  else r.response = 'none'
  // Space created: a runner's marker pulled well away from where he stood (decoys count too).
  if (!r.displacedCounted && r.markers.some((m) => dist(state.players[m.marker]!.pos, m.from) > 3)) {
    r.displacedCounted = true
    state.rotationStats[team][r.kind].displaced++
  }
  if (r.kind === 'wingClearance') wingClearanceBranch(state, team, r, emit)
  if (r.kind === 'crossRun' && r.response === 'handedOver') r.branch = 'marksExchanged'
}

/**
 * Wing clearance branches: A the marker followed the clearing man -> the filler attacks the wing he
 * left; B the marker stayed -> the clearing man is the option (no change); C the marks were handed
 * over -> whoever has more space; D nothing useful -> cancel and recycle.
 */
function wingClearanceBranch(state: MatchState, team: TeamId, r: Rotation, emit?: Emit): void {
  const clearer = r.moves.find((m) => m.job === 'run')
  const filler = r.moves.find((m) => m.job === 'cover')
  if (!clearer || !filler) return
  const vacated = vacatedWing(state, team, clearer.origin ?? clearer.target)
  const vacatedSpace = spaceAt(state, team, vacated)
  const clearerSpace = spaceAt(state, team, state.players[clearer.id]!.pos)
  const attackVacated = () => {
    filler.job = 'run'
    filler.target = vacated
    r.branch = 'attackVacated'
  }
  if (r.response === 'followed' && vacatedSpace > 2.2) attackVacated()
  else if (r.response === 'held') r.branch = 'passToClearer'
  else if (r.response === 'handedOver') {
    if (vacatedSpace > clearerSpace && vacatedSpace > 2.5) attackVacated()
    else r.branch = 'passToClearer'
  } else if (vacatedSpace > 2.5) attackVacated()
  if (!r.branch && clearerSpace < 1.5 && vacatedSpace < 2.2) {
    r.branch = 'noSpace'
    endRotation(state, team, false, 'noSpace', emit)
  }
}

/**
 * Space closed or taken: a runner still on his way whose target an opponent has stepped into (or the
 * human player has moved into) picks the freest point nearby instead.
 */
function reassignTargets(state: MatchState, team: TeamId, r: Rotation): void {
  const human =
    state.humanTeam === team && state.controlledId !== null ? state.players[state.controlledId]! : null
  const rt = state.rotationTeam[team]
  for (const m of r.moves) {
    if (m.job !== 'run' || !moveStarted(state, m)) continue
    const p = state.players[m.id]!
    if (dist(p.pos, m.target) < 3) continue
    const closed = !free(state, team, m.target, 1.2)
    const humanThere = human !== null && dist(human.pos, m.target) < 2
    if (!closed && !humanThere) continue
    let best: Vec2 | null = null
    let bestSpace = -Infinity
    // (Out of the human's way: far enough that he is not in the new spot either.)
    const ringR = humanThere ? 3.5 : 2.5
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      const q = inCourt({ x: m.target.x + Math.cos(a) * ringR, y: m.target.y + Math.sin(a) * ringR })
      if (depthToGoal(state, team, q) < 3.5) continue
      if (human && dist(human.pos, q) < 3) continue
      const sp = spaceAt(state, team, q)
      if (sp > bestSpace) {
        bestSpace = sp
        best = q
      }
    }
    if (!best) continue
    m.target = best
    for (const res of rt.reservations)
      if (res.playerId === m.id && res.instance === r.instance) res.center = { ...best }
  }
}

/** A runner free with an open lane from the carrier: the opportunity the move was for. */
function updateOpportunity(state: MatchState, team: TeamId, r: Rotation, emit?: Emit): void {
  if (r.opportunityCounted) return
  const c = state.ball.ownerId !== null ? state.players[state.ball.ownerId]! : null
  if (!c || c.team !== team) return
  for (const m of r.moves) {
    if ((m.job !== 'run' && m.job !== 'post') || m.id === c.id || !moveStarted(state, m)) continue
    const p = state.players[m.id]!
    if (dist(p.pos, m.target) > 3 || spaceAt(state, team, p.pos) < 2.3) continue
    if (laneOpenness(state, team, c.pos, p.pos) < 1.3 || passInterceptable(state, team, c.pos, p.pos))
      continue
    r.status = 'opportunity'
    r.opportunityCounted = true
    state.rotationStats[team][r.kind].opportunities++
    emit?.({ type: 'RotationOpportunity', tick: state.tick, team, kind: r.kind, instance: r.instance })
    return
  }
}

/**
 * What the team has seen of the opponent's defending (positions only), once a second while it has
 * the ball: do markers go with attackers who move (man-oriented) or hold their zones; how high is the
 * block.
 */
function updateDefenceRead(state: MatchState, team: TeamId, rt: RotationTeamState): void {
  const read = rt.read
  if (state.phase !== 'play' || state.possessionTeam !== team) {
    read.snap = []
    return
  }
  if (state.time - read.lastAt < 1) return
  read.lastAt = state.time
  for (const s of read.snap) {
    const a = state.players[s.attacker]!
    if (s.marker < 0 || dist(a.pos, s.pos) < 2) continue
    const follows = dist(state.players[s.marker]!.pos, a.pos) < 3 ? 1 : 0
    read.follow = read.follow * 0.85 + follows * 0.15
    read.samples++
  }
  read.snap = []
  const owner = state.ball.ownerId
  for (const p of outfield(state, team))
    if (p.id !== owner) read.snap.push({ attacker: p.id, pos: { ...p.pos }, marker: markerOf(state, p, 3) })
  const dir = attackDir(state, team)
  const opp = state.players.filter((o) => o.team !== team && o.role !== 'GK')
  if (opp.length) {
    const depth = opp.reduce((s, o) => s + (o.pos.y * dir + 20) / 40, 0) / opp.length
    read.block = read.block * 0.8 + depth * 0.2
  }
}

/** Shots, goals and counter-attacks credited to the move in progress or just ended. */
function trackOutcomes(state: MatchState, team: TeamId, rt: RotationTeamState): void {
  const b = state.ball
  const shotNow = b.isShot && b.lastTouchTeam === team
  if (shotNow && !rt.shotSeen) {
    const credit = state.rotation[team]?.kind ?? (state.time < rt.creditUntil ? rt.creditKind : null)
    if (credit) state.rotationStats[team][credit].shotsAfter++
    const other = state.rotationTeam[1 - team]!
    if (other.lossKind && state.time - other.lossAt < 8)
      state.rotationStats[1 - team]![other.lossKind].counterShots++
  }
  rt.shotSeen = shotNow
  if (state.score[team] > rt.goalsSeen) {
    const credit = state.rotation[team]?.kind ?? (state.time < rt.creditUntil ? rt.creditKind : null)
    if (credit) state.rotationStats[team][credit].goalsAfter++
  }
  rt.goalsSeen = state.score[team]
}

/** An individual movement whose player got the ball (while it ran or just after) succeeded. */
function trackIndividual(state: MatchState, team: TeamId): void {
  const id = state.ball.ownerId
  if (id === null) return
  const p = state.players[id]!
  const mv = p.aiMove
  if (p.team !== team || !mv || mv.received || state.time > mv.until + 1) return
  mv.received = true
  recordIndividual(state, team, mv.kind, 'completed')
}

/** Individual movement statistics (V-cut, between the lines). */
export function recordIndividual(
  state: MatchState,
  team: TeamId,
  kind: IndividualKind,
  what: 'started' | 'completed' | 'cancelled',
): void {
  state.rotationStats[team][kind][what]++
}

// --------------------------------------------------------------------- advancing the moves

/** Combinations: completion, cancellation, the back-post swap, link and switch hand-overs. */
function advanceCombination(state: MatchState, team: TeamId, r: Rotation, emit?: Emit): void {
  const owner = state.ball.ownerId
  if (r.kind === 'wallPass' && owner !== null) {
    const wall = r.moves.find((m) => m.job === 'wall')
    if (!wall) return endRotation(state, team, false, 'otherReceiver', emit)
    if (owner === wall.id) r.wallTouched = true
    else if (owner === r.carrierId && r.wallTouched) endRotation(state, team, true, 'returned', emit)
    else if (owner !== r.carrierId) endRotation(state, team, false, 'otherReceiver', emit)
    return
  }
  if (r.kind === 'isolation') return advanceIsolation(state, team, r, emit)
  // The carrier has played it to somebody outside the move: over now (so the pass can start the
  // next rotation at once).
  const b = state.ball
  if (
    owner === null &&
    b.mode === 'free' &&
    b.lastTouchId === r.carrierId &&
    b.lastTouchTeam === team &&
    !b.isShot
  ) {
    const to = b.intendedReceiverId
    if (to !== null && !r.moves.some((m) => m.id === to))
      return endRotation(state, team, false, 'otherReceiver', emit)
  }
  if (owner !== null && owner !== r.carrierId) {
    const m = r.moves.find((x) => x.id === owner)
    if (!m) return endRotation(state, team, false, 'otherReceiver', emit)
    if (m.job === 'link' || m.job === 'switch') {
      // Third man / switch via the deep man: the ball is on its way through him.
      r.wallTouched = true
      r.carrierId = owner
      return
    }
    const done =
      m.job === 'run' ||
      m.job === 'post' ||
      (m.job === 'drop' &&
        (r.kind === 'pivot' ||
          r.kind === 'pivotLayoff' ||
          r.kind === 'oppositeMove' ||
          r.kind === 'wideOverload')) ||
      (m.job === 'cover' && r.kind === 'wideOverload')
    if (done) {
      if (r.kind === 'wideOverload' && m.job === 'cover') r.branch = 'switched'
      endRotation(state, team, true, 'reachedRunner', emit)
    } else endRotation(state, team, false, 'otherReceiver', emit)
    return
  }
  if (r.kind === 'backPost' && !r.swapped && state.time - r.started > ROTATION.backPostSwap)
    swapBackPost(state, team, r)
}

/** Isolation: done when the dribbler gets past his man or shoots; off if a second defender comes. */
function advanceIsolation(state: MatchState, team: TeamId, r: Rotation, emit?: Emit): void {
  const owner = state.ball.ownerId
  const c = state.players[r.carrierId]!
  if (owner !== c.id) {
    if (state.ball.isShot) return endRotation(state, team, true, 'reachedRunner', emit)
    if (owner !== null) return endRotation(state, team, false, 'otherReceiver', emit)
    return
  }
  const dir = attackDir(state, team)
  const close = state.players.filter((o) => o.team !== team && o.role !== 'GK' && dist(o.pos, c.pos) < 3.5)
  // (Lab drill: the computer defenders cannot take the ball, so they do not end the 1 v 1.)
  if (close.length >= 2 && !state.drill) {
    r.branch = 'helpArrived'
    return endRotation(state, team, false, 'noSpace', emit)
  }
  if (close.length === 0 || close.every((o) => (o.pos.y - c.pos.y) * dir < -0.8)) {
    r.branch = 'beatenMan'
    endRotation(state, team, true, 'reachedRunner', emit)
  }
}

/**
 * Rotations: runners pass their via point; the carrier's pass ends the cycle (completed if it went
 * to a runner or into the pivot, otherwise the pass to a side starts the next cycle). Returns false
 * once the rotation has ended.
 */
function advancePattern(state: MatchState, team: TeamId, r: Rotation, emit?: Emit): boolean {
  for (const m of r.moves)
    if (m.via && !m.viaDone && dist(state.players[m.id]!.pos, m.via) < 1.6) m.viaDone = true
  const b = state.ball
  const owner = b.ownerId
  const pivot = pivotOf(state, team)
  if (owner !== null && owner !== r.carrierId) {
    const m = r.moves.find((x) => x.id === owner)
    const done = m?.job === 'run' || (pivot !== null && owner === pivot.id)
    endRotation(
      state,
      team,
      done,
      done ? (m?.job === 'run' ? 'reachedRunner' : 'pivot') : 'otherReceiver',
      emit,
    )
    return false
  }
  if (owner === null && b.mode === 'free' && b.lastTouchId === r.carrierId && b.lastTouchTeam === team) {
    const receiver = b.intendedReceiverId
    const sw = r.moves.find((m) => m.job === 'switch' && m.id === r.carrierId)
    if (sw && receiver !== null && receiver === sw.passTo) {
      // The quick switch to the far wing: he moves across into the wing the runner left.
      sw.job = 'cover'
      r.carrierId = receiver
      return true
    }
    const m = r.moves.find((x) => x.id === receiver)
    const done = m?.job === 'run' || (pivot !== null && receiver === pivot.id)
    endRotation(state, team, done, done ? (m?.job === 'run' ? 'reachedRunner' : 'pivot') : 'cycle', emit)
    return false
  }
  return true
}

function swapBackPost(state: MatchState, team: TeamId, r: Rotation): void {
  const c = state.players[r.carrierId]!
  const s = backPostSpots(state, team, c)
  r.swapped = true
  for (const m of r.moves) {
    if (m.job === 'post') {
      m.job = 'run'
      m.target = s.top
    } else if (m.job === 'run') {
      m.job = 'post'
      m.target = s.back
    }
  }
}

// ------------------------------------------------------------------ carrier-side helpers

/**
 * The carrier may start his own combination (1-2, pisada) over the move in progress: always over a
 * rotation; over a combination built round him that has not yet produced its opportunity (the ball
 * carrier takes a better immediate chance instead of completing a move).
 */
function carrierMayOverride(state: MatchState, p: PlayerState): boolean {
  const r = state.rotation[p.team]
  if (!r || isPattern(r.kind)) return true
  return r.carrierId === p.id && r.status !== 'opportunity' && r.kind !== 'wallPass' && r.kind !== 'pisada'
}

/** About how long the ball takes into the wall and back to the runner (seconds). */
const WALL_PASS_BALL_TIME = 1.2
/** The wall's marker reacts this late to the return (he is marking the man about to receive). */
const WALL_MARKER_REACTION = 0.5

/**
 * Wall pass (carrier-initiated): a defender close in front of the carrier, a free teammate 3.5-9 m
 * away to the side or a little ahead with a clear lane, and space behind the defender for the run.
 */
export function wallPassOption(
  state: MatchState,
  p: PlayerState,
): { wall: PlayerState; run: Vec2; defender: PlayerState } | null {
  if (p.role === 'GK' || !state.teams[p.team].tactics.rotations || !carrierMayOverride(state, p)) return null
  if (!state.rotation[p.team] && state.time < state.rotationReadyAt[p.team]) return null
  if (!familyAllowed(state, p.team, 'wallPass', state.rotationTeam[p.team])) return null
  const dir = state.teams[p.team].attackDir
  const goalY = dir * 20
  const depth = (goalY - p.pos.y) * dir
  if (depth > 30 || depth < 9) return null
  const defender = defenderInFront(state, p, 4, 2.2)
  if (!defender) return null
  let best: { wall: PlayerState; run: Vec2; score: number } | null = null
  for (const w of movable(state, p.team)) {
    if (w.id === p.id) continue
    const d = dist(w.pos, p.pos)
    const forward = (w.pos.y - p.pos.y) * dir
    if (d < 3.5 || d > 9 || forward < -2.5 || forward > 6) continue
    // The wall must be able to play it back first time: free of his own man.
    if (!free(state, p.team, w.pos, 2.4)) continue
    if (passInterceptable(state, p.team, p.pos, w.pos)) continue
    const side = Math.sign(w.pos.x - p.pos.x) || 1
    const run = inCourt({ x: clamp(defender.pos.x + side * 1.8, -8.5, 8.5), y: defender.pos.y + dir * 3.5 })
    if ((goalY - run.y) * dir < 3) continue
    if (!free(state, p.team, run, 2.4, defender.id)) continue
    // Not beaten to it: a covering man must not get there clearly first (the wall's marker reacts late).
    const mine = estimateTimeToReach(p, run)
    const wallMarker = markerOf(state, w)
    const beaten = state.players.some(
      (o) =>
        o.team !== p.team &&
        o.role !== 'GK' &&
        o.id !== defender.id &&
        estimateTimeToReach(o, run) + (o.id === wallMarker ? WALL_MARKER_REACTION : 0) <
          Math.max(mine, WALL_PASS_BALL_TIME) - 0.15,
    )
    if (beaten) continue
    if (passInterceptable(state, p.team, w.pos, run, 0.25, (o) => o.id === defender.id)) continue
    if (!balanceOk(state, p.team, p.pos.y, [p.id, w.id])) continue
    const score = laneOpenness(state, p.team, p.pos, w.pos) - Math.abs(d - 5.5) * 0.2
    if (!best || score > best.score) best = { wall: w, run, score }
  }
  return best ? { wall: best.wall, run: best.run, defender } : null
}

/** Start the wall pass (called by the carrier as he plays the ball into the wall). */
export function startWallPass(
  state: MatchState,
  p: PlayerState,
  wall: PlayerState,
  run: Vec2,
  emit?: Emit,
): void {
  if (state.rotation[p.team]) endRotation(state, p.team, false, 'replaced', emit)
  startRotation(
    state,
    p.team,
    'wallPass',
    p.id,
    [
      { id: p.id, job: 'run', target: run },
      { id: wall.id, job: 'wall', target: { ...wall.pos } },
    ],
    { trigger: 'defenderInFront' },
    emit,
  )
}

/** The wall with the ball: the runner of his 1-2 (to be found first time), else null. */
export function wallPassRunner(
  state: MatchState,
  p: PlayerState,
): { runner: PlayerState; target: Vec2 } | null {
  const r = state.rotation[p.team]
  if (!r || r.kind !== 'wallPass' || state.ball.ownerId !== p.id) return null
  if (!r.moves.some((m) => m.id === p.id && m.job === 'wall')) return null
  const run = r.moves.find((m) => m.job === 'run')
  if (!run) return null
  return { runner: state.players[r.carrierId]!, target: run.target }
}

/** Third man: the carrier's ball into the link (B), while the third man is going. */
export function thirdManLinkTarget(state: MatchState, p: PlayerState): PlayerState | null {
  const r = state.rotation[p.team]
  if (!r || r.kind !== 'thirdMan' || r.carrierId !== p.id || r.wallTouched) return null
  const link = r.moves.find((m) => m.job === 'link')
  if (!link) return null
  const b = state.players[link.id]!
  if (passInterceptable(state, p.team, p.pos, b.pos) || spaceAt(state, p.team, b.pos) < 1.6) return null
  return b
}

/** The link with the ball: the third man and his target (played first time), else null. */
export function thirdManRunner(
  state: MatchState,
  p: PlayerState,
): { runner: PlayerState; target: Vec2 } | null {
  const r = state.rotation[p.team]
  if (!r || r.kind !== 'thirdMan' || state.ball.ownerId !== p.id) return null
  const link = r.moves.find((m) => m.job === 'link')
  if (!link || link.id !== p.id) return null
  const run = r.moves.find((m) => m.job === 'run')
  if (!run) return null
  return { runner: state.players[run.id]!, target: run.target }
}

/** Switch of play: the carrier's switch — straight across, or into the deep man who plays it on. */
export function switchPlayTarget(state: MatchState, p: PlayerState): PlayerState | null {
  const r = state.rotation[p.team]
  if (!r || r.kind !== 'switchPlay' || r.carrierId !== p.id || r.wallTouched) return null
  const far = r.moves.find((m) => m.job === 'run')
  if (!far) return null
  const f = state.players[far.id]!
  const via = r.moves.find((m) => m.job === 'switch')
  if (!via && dist(f.pos, p.pos) < 18 && !passInterceptable(state, p.team, p.pos, f.pos)) return f
  if (via) {
    const d = state.players[via.id]!
    if (!passInterceptable(state, p.team, p.pos, d.pos)) return d
  }
  return null
}

/** Isolation: the carrier has the corridor cleared for his 1 v 1 (the defender to beat), else null. */
export function isolationDefender(state: MatchState, p: PlayerState): PlayerState | null {
  const r = state.rotation[p.team]
  if (!r || r.kind !== 'isolation' || r.carrierId !== p.id) return null
  return defenderInFront(state, p, 4.5, 2.5)
}

function opponentEtaTo(state: MatchState, team: TeamId, pos: Vec2): number {
  let best = Infinity
  for (const o of state.players)
    if (o.team !== team && o.role !== 'GK') best = Math.min(best, estimateTimeToReach(o, pos))
  return best
}

/** Seconds a pisada roll takes to reach the teammate's path (short, soft). */
const PISADA_LEAD = 0.45

/**
 * Pisada (sole layoff): the carrier, pressed, rolls the ball with the sole into the path of a
 * teammate coming past him close by; the ball is a normal pass (it can be cut out).
 */
export function pisadaOption(state: MatchState, p: PlayerState): { mate: PlayerState; point: Vec2 } | null {
  if (p.role === 'GK' || !state.teams[p.team].tactics.rotations || !carrierMayOverride(state, p)) return null
  if (!familyAllowed(state, p.team, 'pisada', state.rotationTeam[p.team])) return null
  if (spaceAt(state, p.team, p.pos) > 2.6) return null
  let presser: PlayerState | null = null
  for (const o of state.players)
    if (o.team !== p.team && o.role !== 'GK' && (!presser || dist(o.pos, p.pos) < dist(presser.pos, p.pos)))
      presser = o
  for (const t of movable(state, p.team)) {
    if (t.id === p.id) continue
    const d = dist(t.pos, p.pos)
    const speed = Math.hypot(t.vel.x, t.vel.y)
    if (d < 1.2 || d > 4 || speed < 2.5) continue
    // Coming past: moving across or beyond the carrier, not away from him.
    const rel = { x: p.pos.x - t.pos.x, y: p.pos.y - t.pos.y }
    if ((rel.x * t.vel.x + rel.y * t.vel.y) / (d * speed) < 0.1) continue
    const point = inCourt({
      x: t.pos.x + t.vel.x * (PISADA_LEAD + 0.25),
      y: t.pos.y + t.vel.y * (PISADA_LEAD + 0.25),
    })
    if (dist(point, p.pos) > 3 || spaceAt(state, p.team, point) < 2.5) continue
    // He gets there clearly before anybody else can (the roll is slow).
    if (estimateTimeToReach(t, point) + 0.3 > opponentEtaTo(state, p.team, point)) continue
    // Left behind him, away from the presser (his body between the presser and the ball).
    if (presser) {
      const a = { x: point.x - p.pos.x, y: point.y - p.pos.y }
      const b = { x: presser.pos.x - p.pos.x, y: presser.pos.y - p.pos.y }
      if (a.x * b.x + a.y * b.y > 0) continue
    }
    if (passInterceptable(state, p.team, p.pos, point)) continue
    return { mate: t, point }
  }
  return null
}

export function startPisada(
  state: MatchState,
  p: PlayerState,
  mate: PlayerState,
  point: Vec2,
  emit?: Emit,
): void {
  if (state.rotation[p.team]) endRotation(state, p.team, false, 'replaced', emit)
  startRotation(
    state,
    p.team,
    'pisada',
    p.id,
    [{ id: mate.id, job: 'run', target: point }],
    { trigger: 'mateComingPast' },
    emit,
  )
}

/**
 * The pass that keeps a rotation going, for a carrier in the rotation zone with nothing better on:
 * the 3-1 middle man to a wing, a 3-1 wing into the middle, a 4-0 central player to his wing or to
 * the other central player, a 4-0 wing back to a central player. The most open safe target, or null.
 * A team accepting more passing risk plays it into a narrower lane.
 */
export function rotationPassTarget(state: MatchState, p: PlayerState): PlayerState | null {
  const team = p.team
  const t = state.teams[team].tactics
  if (!t.rotations || (t.formation !== '3-1' && t.formation !== '4-0') || p.role === 'GK') return null
  const r = state.rotation[team]
  if (r && (!isPattern(r.kind) || r.carrierId !== p.id)) return null
  const depth = depthToGoal(state, team, p.pos)
  if (depth < ROTATION.zone.near || depth > ROTATION.zone.far) return null
  const pivot = pivotOf(state, team)
  if (pivot && p.id === pivot.id) return null
  const minLane = 1.2 - s01(styleOf(state, team).passingRisk) * 0.4
  let best: PlayerState | null = null
  let bestScore = -Infinity
  for (const q of outfield(state, team)) {
    if (q.id === p.id || (pivot && q.id === pivot.id)) continue
    if (Math.abs(q.pos.y - p.pos.y) > 9 || dist(q.pos, p.pos) < 3) continue
    if (t.formation === '3-1') {
      if (Math.abs(p.pos.x) < 3 ? Math.abs(q.pos.x) < 3.5 : Math.abs(q.pos.x) >= 3) continue
    } else if (Math.abs(p.pos.x) < 4) {
      if (Math.abs(q.pos.x) >= 4.5 && q.pos.x * p.pos.x < -1) continue
    } else if (Math.abs(q.pos.x) >= 4) continue
    if (!free(state, team, q.pos, 2.5) || passInterceptable(state, team, p.pos, q.pos)) continue
    const lane = laneOpenness(state, team, p.pos, q.pos)
    if (lane < minLane) continue
    const score = Math.min(lane, 3) - Math.abs(dist(q.pos, p.pos) - 8) * 0.08
    if (score > bestScore) {
      bestScore = score
      best = q
    }
  }
  return best
}

export type { RotationStats as RotationKindStats }
export function statsOf(state: MatchState, team: TeamId): Record<string, RotationStats> {
  return state.rotationStats[team]
}

/**
 * Lab drill: the pattern is played to its end — the runner of the move in a better scoring position
 * than the carrier, with a pass into his path nobody can cut out, is found. (In a match the carrier's
 * normal options decide.) Returns the runner, or null.
 */
export function drillRunner(state: MatchState, p: PlayerState): PlayerState | null {
  const r = state.rotation[p.team]
  if (!state.drill || !r) return null
  const dir = state.teams[p.team].attackDir
  let best: PlayerState | null = null
  let bestV = -Infinity
  for (const m of r.moves) {
    if ((m.job !== 'run' && m.job !== 'post') || m.id === p.id || !moveStarted(state, m)) continue
    const t = state.players[m.id]!
    // He has arrived (within 3 m of his target, or past his first point and goal-side of the ball).
    const arrived =
      dist(t.pos, m.target) < 3 ||
      (m.via !== undefined && m.viaDone === true && (t.pos.y - p.pos.y) * dir > 3)
    if (!arrived) continue
    // Into his stride, kept well inside the court (a ball down the line must not run out).
    const raw = predictPassTarget(p, t, false, dir, true)
    const lead = { x: clamp(raw.x, -8.2, 8.2), y: clamp(raw.y, -18.5, 18.5) }
    // (Drill: the computer defenders let passes go by; only a human defender in the line blocks it.)
    const others = state.players
      .filter((o) => o.team !== p.team && o.id !== state.controlledId)
      .map((o) => o.id)
    if (!pathFree(state, p.team, p.pos, lead, 0.7, others) || dist(lead, p.pos) > 20) continue
    const v = shotValueAt(state, p.team, lead)
    if (v > bestV) {
      bestV = v
      best = t
    }
  }
  return best
}

/**
 * A move built round this carrier whose run is still on its way (not within 2.5 m of its target,
 * time left): the carrier keeps the ball for it rather than cycling it on.
 */
export function rotationRunPending(state: MatchState, p: PlayerState): boolean {
  const r = state.rotation[p.team]
  if (!r || r.carrierId !== p.id || r.until - state.time < 0.8 || r.kind === 'wallPass') return false
  return r.moves.some(
    (m) => m.job === 'run' && m.id !== p.id && dist(state.players[m.id]!.pos, m.target) > 2.5,
  )
}
