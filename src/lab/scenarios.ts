/**
 * Tactical Lab scenarios (Milestone 6, stage 4): set situations placed straight into a running match
 * state — a breakaway, a 2 v 0, the rotations, a build-up against the press, a counter-attack. They
 * are headless (simulation only), so the same scenarios drive the Lab screen and the tactical tests.
 *
 * Positions are written from the attacking team's point of view: `d` is the distance (m) from the
 * goal the attackers attack, `x` is to the attackers' right (+) or left (-) as they face that goal.
 * `applyScenario` mirrors them onto either team.
 */
import type { Vec2 } from '../core/math/vec2'
import type { MatchState, PlayerRole, PlayerState, TeamId } from '../simulation/MatchState'
import type { MatchEvent } from '../simulation/Events'
import { COURT, TICK_RATE } from '../simulation/SimulationConfig'
import type { Formation, PressingHeight } from '../simulation/Tactics'
import type { RotationKind } from '../ai/team/rotations'
import { emptyRotationTeam } from '../ai/team/rotationState'
import { FAMILY_IDS, KIND_FAMILY, type FamilyId, type FamilyPriority } from '../ai/team/rotationLibrary'

export type ScenarioId =
  | 'breakaway'
  | 'twoOnKeeper'
  | 'counter3v2'
  | 'baseEight'
  | 'baseEightWing'
  | 'butterfly'
  | 'fourCircle'
  | 'overlap'
  | 'wallPass'
  | 'pivotRotation'
  | 'backPost'
  | 'buildUpPress'
  | 'wingClearance'
  | 'threeCircle'
  | 'crossRun'
  | 'paralela'
  | 'thirdMan'
  | 'underlap'
  | 'pivotLayoff'
  | 'switchPlay'
  | 'wideOverload'
  | 'doubleCut'
  | 'oppositeMove'
  | 'diagonalRun'
  | 'isolation'

type OutfieldRole = Exclude<PlayerRole, 'GK'>

interface Spot {
  x: number
  d: number
  /** Running speed (m/s) towards the goal the attackers attack (negative: towards their own). */
  run?: number
  /** Facing his own goal (a pivot with his back to goal). */
  backToGoal?: boolean
}

export interface Scenario {
  id: ScenarioId
  /** The attackers' outfield players (all four). */
  attackers: Record<OutfieldRole, Spot>
  /** The defenders' outfield players (all four). */
  defenders: Record<OutfieldRole, Spot>
  /** Who has the ball. */
  carrier: OutfieldRole
  /** Tactics the scenario is built for (applied when the scenario is loaded; changeable in the Lab). */
  attackFormation: Formation
  defendPressing: PressingHeight
  /** Just won the ball: the attackers start in the counter-attack window. */
  counter: boolean
  /** Seconds before the attempt ends as "timeout". */
  timeLimit: number
  /** The rotation the scenario shows (counted per attempt), if any. */
  rotation: RotationKind | null
}

const s = (x: number, d: number, run = 0): Spot => ({ x, d, run })
const back = (x: number, d: number): Spot => ({ x, d, run: 0, backToGoal: true })

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  breakaway: {
    id: 'breakaway',
    attackers: { PIVOT: s(0.5, 17, 5), ALA_L: s(-5, 29, 3), ALA_R: s(5, 30, 3), FIXO: s(0, 34) },
    defenders: { FIXO: s(-1, 21, 4), ALA_L: s(3, 23, 3), ALA_R: s(-4, 25, 2), PIVOT: s(1, 28, 1) },
    carrier: 'PIVOT',
    attackFormation: '3-1',
    defendPressing: 'mid',
    counter: true,
    timeLimit: 6,
    rotation: null,
  },
  twoOnKeeper: {
    id: 'twoOnKeeper',
    attackers: { ALA_R: s(2.5, 13, 4), PIVOT: s(-4, 13.5, 4), ALA_L: s(-6, 24, 2), FIXO: s(0, 30) },
    defenders: { FIXO: s(1, 19, 4), ALA_L: s(-2, 20, 4), ALA_R: s(4, 22, 3), PIVOT: s(0, 26, 2) },
    carrier: 'ALA_R',
    attackFormation: '3-1',
    defendPressing: 'mid',
    counter: true,
    timeLimit: 6,
    rotation: null,
  },
  counter3v2: {
    id: 'counter3v2',
    attackers: { ALA_L: s(-2.5, 24, 5), PIVOT: s(3, 22, 5), ALA_R: s(7, 25, 5), FIXO: s(0, 33, 1) },
    defenders: { FIXO: s(0, 15, -1), ALA_L: s(-3, 18, -2), ALA_R: s(4, 30, 4), PIVOT: s(-1, 32, 4) },
    carrier: 'ALA_L',
    attackFormation: '3-1',
    defendPressing: 'mid',
    counter: true,
    timeLimit: 8,
    rotation: null,
  },
  overlap: {
    id: 'overlap',
    attackers: { ALA_R: s(7, 18), FIXO: s(4.5, 23), ALA_L: s(-4, 21), PIVOT: s(0, 9) },
    defenders: { ALA_L: s(7, 15.5), PIVOT: s(0, 7.8), ALA_R: s(-4, 15), FIXO: s(2, 12) },
    carrier: 'ALA_R',
    attackFormation: '3-1',
    defendPressing: 'mid',
    counter: false,
    timeLimit: 10,
    rotation: 'overlap',
  },
  wallPass: {
    id: 'wallPass',
    attackers: { FIXO: s(0, 20), ALA_R: s(5, 19), ALA_L: s(-5, 25), PIVOT: s(-2, 8) },
    // The wall's marker caught up the court and the pivot marked from in front (no ball into him):
    // the 1-2 is the way past the first man.
    defenders: { PIVOT: s(0.3, 17.5), ALA_L: s(6, 23.5), FIXO: s(-3, 9), ALA_R: s(-5, 21) },
    carrier: 'FIXO',
    attackFormation: '3-1',
    defendPressing: 'mid',
    counter: false,
    timeLimit: 10,
    rotation: 'wallPass',
  },
  pivotRotation: {
    id: 'pivotRotation',
    attackers: { ALA_L: s(-3.5, 21), FIXO: s(2, 25), PIVOT: s(0, 8), ALA_R: s(6, 15) },
    defenders: { ALA_R: s(-3, 16.5), FIXO: s(0, 6.8), ALA_L: s(5, 12.5), PIVOT: s(2.5, 18) },
    carrier: 'ALA_L',
    attackFormation: '3-1',
    defendPressing: 'mid',
    counter: false,
    timeLimit: 10,
    rotation: 'pivot',
  },
  baseEight: {
    id: 'baseEight',
    // 3-1 build-up against a mid-block: the middle man with the ball, the wings free.
    attackers: { FIXO: s(0, 27), ALA_L: s(-7, 25), ALA_R: s(7, 25), PIVOT: s(0, 12) },
    defenders: { PIVOT: s(0, 21.5), ALA_L: s(4.5, 19), ALA_R: s(-4.5, 19), FIXO: s(0, 10.8) },
    carrier: 'FIXO',
    attackFormation: '3-1',
    defendPressing: 'mid',
    counter: false,
    timeLimit: 10,
    rotation: 'baseEight',
  },
  baseEightWing: {
    id: 'baseEightWing',
    // The right wing has it, the way up the wing shut off: the ball goes back into the middle.
    attackers: { ALA_R: s(7, 24), FIXO: s(0, 27), ALA_L: s(-7, 25), PIVOT: s(0, 12) },
    defenders: { ALA_L: s(6.8, 21.8), PIVOT: s(1.5, 19.5), ALA_R: s(-3.5, 18), FIXO: s(0, 10.8) },
    carrier: 'ALA_R',
    attackFormation: '3-1',
    defendPressing: 'mid',
    counter: false,
    timeLimit: 10,
    rotation: 'baseEightWing',
  },
  butterfly: {
    id: 'butterfly',
    // 4-0 against a mid-block sitting off: the middle is shut, the ball goes out to the free wing.
    attackers: { FIXO: s(1.5, 22), PIVOT: s(-2.5, 22), ALA_R: s(7.5, 21), ALA_L: s(-7.5, 21) },
    defenders: { PIVOT: s(0.5, 15.5), ALA_R: s(-3, 16), ALA_L: s(3.5, 12), FIXO: s(-3.5, 11) },
    carrier: 'FIXO',
    attackFormation: '4-0',
    defendPressing: 'mid',
    counter: false,
    timeLimit: 10,
    rotation: 'butterfly',
  },
  fourCircle: {
    id: 'fourCircle',
    // 4-0 with both wings marked tight: the ball goes across the middle instead.
    attackers: { FIXO: s(1.5, 22), PIVOT: s(-2.5, 22), ALA_R: s(7.5, 21), ALA_L: s(-7.5, 21) },
    defenders: { PIVOT: s(1, 16.5), ALA_L: s(7.2, 20), ALA_R: s(-7.2, 20), FIXO: s(0, 11) },
    carrier: 'FIXO',
    attackFormation: '4-0',
    defendPressing: 'mid',
    counter: false,
    timeLimit: 10,
    rotation: 'fourCircle',
  },
  backPost: {
    id: 'backPost',
    attackers: { ALA_R: s(6, 8), ALA_L: s(-5, 11), PIVOT: s(1, 9), FIXO: s(0, 20) },
    defenders: { ALA_L: s(5.5, 6.5), FIXO: s(0.5, 6.5), ALA_R: s(-4, 9), PIVOT: s(0, 15) },
    carrier: 'ALA_R',
    attackFormation: '3-1',
    defendPressing: 'mid',
    counter: false,
    timeLimit: 10,
    rotation: 'backPost',
  },
  buildUpPress: {
    id: 'buildUpPress',
    attackers: { FIXO: s(0, 34), ALA_L: s(-7, 31), ALA_R: s(7, 31), PIVOT: s(0, 22) },
    defenders: { PIVOT: s(0, 29), ALA_L: s(5.5, 27), ALA_R: s(-5.5, 27), FIXO: s(0, 21) },
    carrier: 'FIXO',
    attackFormation: '3-1',
    defendPressing: 'high',
    counter: false,
    timeLimit: 10,
    rotation: null,
  },
  // ----- rotation library scenarios (original positions; see FUTSAL_ROTATIONS.md) -----
  wingClearance: {
    id: 'wingClearance',
    // The right wing is marked tight ahead of the ball; the left ala waits deeper on that side.
    attackers: { FIXO: s(0, 22), ALA_R: s(7, 18), ALA_L: s(3, 24.5), PIVOT: s(-1, 10) },
    defenders: { ALA_L: s(6.6, 16.6), PIVOT: s(0.5, 18.8), FIXO: s(-0.8, 8.8), ALA_R: s(-4, 19.5) },
    carrier: 'FIXO',
    attackFormation: '3-1',
    defendPressing: 'mid',
    counter: false,
    timeLimit: 10,
    rotation: 'wingClearance',
  },
  threeCircle: {
    id: 'threeCircle',
    // The right wing is shut down the line and the far wing is marked: back into the middle, up the
    // wing, the far wing comes across.
    attackers: { ALA_R: s(7, 23), FIXO: s(0, 27), ALA_L: s(-7, 24), PIVOT: s(0, 12) },
    defenders: { ALA_L: s(6.8, 20.8), PIVOT: s(1.5, 22), ALA_R: s(-6.6, 22.6), FIXO: s(0, 10.8) },
    carrier: 'ALA_R',
    attackFormation: '3-1',
    defendPressing: 'mid',
    counter: false,
    timeLimit: 10,
    rotation: 'threeCircle',
  },
  crossRun: {
    id: 'crossRun',
    // 2-2: the carrier has time; the front pair is marked from goal-side and swaps sides.
    attackers: { FIXO: s(-2, 22), ALA_R: s(4, 24), ALA_L: s(-5, 13), PIVOT: s(4.5, 13) },
    defenders: { ALA_L: s(4.5, 11.6), ALA_R: s(-5, 11.6), PIVOT: s(-1, 17.5), FIXO: s(0, 7) },
    carrier: 'FIXO',
    attackFormation: '2-2',
    defendPressing: 'mid',
    counter: false,
    timeLimit: 10,
    rotation: 'crossRun',
  },
  paralela: {
    id: 'paralela',
    // The right wing has time; the man behind him goes down the line into the space behind.
    attackers: { ALA_R: s(7, 18), FIXO: s(5, 20.5), ALA_L: s(-6, 20), PIVOT: s(-3, 9) },
    defenders: { ALA_L: s(4.8, 13.5), PIVOT: s(-3, 7.8), ALA_R: s(-5, 18), FIXO: s(-2, 17.5) },
    carrier: 'ALA_R',
    attackFormation: '3-1',
    defendPressing: 'mid',
    counter: false,
    timeLimit: 10,
    rotation: 'paralela',
  },
  thirdMan: {
    id: 'thirdMan',
    // A to B (the right ala, free) while C (the left ala) is already going beyond him.
    attackers: { FIXO: s(0, 22), ALA_R: s(5, 17), ALA_L: s(-1, 16), PIVOT: s(-5, 8) },
    defenders: { ALA_L: s(7.5, 15.5), PIVOT: s(-2, 18), ALA_R: s(-2.5, 15), FIXO: s(-5, 6.8) },
    carrier: 'FIXO',
    attackFormation: '3-1',
    defendPressing: 'mid',
    counter: false,
    timeLimit: 10,
    rotation: 'thirdMan',
  },
  underlap: {
    id: 'underlap',
    // The wide carrier's marker closes the line: the inside channel is the way.
    attackers: { ALA_R: s(7, 17), FIXO: s(3, 22), ALA_L: s(-5, 20), PIVOT: s(-2.5, 8) },
    defenders: { ALA_L: s(7.6, 15.6), PIVOT: s(-2.5, 6.8), ALA_R: s(-4.5, 18), FIXO: s(-1, 14) },
    carrier: 'ALA_R',
    attackFormation: '3-1',
    defendPressing: 'mid',
    counter: false,
    timeLimit: 10,
    rotation: 'underlap',
  },
  pivotLayoff: {
    id: 'pivotLayoff',
    // The pivot has it with his back to goal and a man on him: lay-off spot and far post.
    attackers: { PIVOT: back(0.5, 9), ALA_R: s(4, 14), ALA_L: s(-5, 15), FIXO: s(0, 22) },
    defenders: { FIXO: s(0.5, 7.8), ALA_L: s(4.5, 12), ALA_R: s(-4.5, 13), PIVOT: s(0, 17) },
    carrier: 'PIVOT',
    attackFormation: '3-1',
    defendPressing: 'mid',
    counter: false,
    timeLimit: 10,
    rotation: 'pivotLayoff',
  },
  switchPlay: {
    id: 'switchPlay',
    // The defence has shifted over to the ball on the right; the left wing is free.
    attackers: { ALA_R: s(6, 20), FIXO: s(1, 24), PIVOT: s(2, 12), ALA_L: s(-6.5, 19) },
    defenders: { ALA_L: s(5.5, 17.8), PIVOT: s(3, 16.5), FIXO: s(2, 10.8), ALA_R: s(3.5, 21) },
    carrier: 'ALA_R',
    attackFormation: '4-0',
    defendPressing: 'mid',
    counter: false,
    timeLimit: 10,
    rotation: 'switchPlay',
  },
  wideOverload: {
    id: 'wideOverload',
    // Ball on the right with one defender there and nobody with the carrier: bring two over.
    attackers: { ALA_R: s(6.5, 16), FIXO: s(-2, 21), PIVOT: s(-2.5, 11), ALA_L: s(-6, 17) },
    defenders: { ALA_L: s(6, 13.8), PIVOT: s(-2, 9.5), FIXO: s(-1.5, 17), ALA_R: s(-5, 15) },
    carrier: 'ALA_R',
    attackFormation: '2-2',
    defendPressing: 'mid',
    counter: false,
    timeLimit: 10,
    rotation: 'wideOverload',
  },
  doubleCut: {
    id: 'doubleCut',
    // The right ala has time at the edge of the final third: near post and far post at once.
    attackers: { ALA_R: s(5, 16), PIVOT: s(1, 12), ALA_L: s(-4, 14), FIXO: s(0, 23) },
    defenders: { ALA_L: s(4, 12.5), PIVOT: s(-3.5, 12.2), FIXO: s(1, 9.5), ALA_R: s(-1, 18) },
    carrier: 'ALA_R',
    attackFormation: '4-0',
    defendPressing: 'mid',
    counter: false,
    timeLimit: 10,
    rotation: 'doubleCut',
  },
  oppositeMove: {
    id: 'oppositeMove',
    // Two attackers ahead, both marked: one comes short, the other goes in behind.
    attackers: { FIXO: s(0, 22), PIVOT: s(-3, 12), ALA_L: s(3.5, 14), ALA_R: s(5, 24) },
    defenders: { FIXO: s(-3, 10.8), ALA_L: s(3.5, 12.6), PIVOT: s(0, 19), ALA_R: s(4.5, 21) },
    carrier: 'FIXO',
    attackFormation: '2-2',
    defendPressing: 'mid',
    counter: false,
    timeLimit: 10,
    rotation: 'oppositeMove',
  },
  diagonalRun: {
    id: 'diagonalRun',
    // The carrier is free in midcourt; the left ala attacks the gap across towards goal.
    attackers: { FIXO: s(0, 21), ALA_L: s(-3, 19), ALA_R: s(6, 19), PIVOT: s(3, 8.5) },
    defenders: { ALA_R: s(-3, 17.6), FIXO: s(3, 7), ALA_L: s(6.5, 19.5), PIVOT: s(-1.5, 23) },
    carrier: 'FIXO',
    attackFormation: '3-1',
    defendPressing: 'mid',
    counter: false,
    timeLimit: 10,
    rotation: 'diagonalRun',
  },
  isolation: {
    id: 'isolation',
    // A 1 v 1 in the right half-space near goal; the teammates near him clear the corridor.
    attackers: { ALA_R: s(4, 14), PIVOT: s(1.5, 10), ALA_L: s(-4.5, 14), FIXO: s(0, 22) },
    defenders: { ALA_L: s(4, 12), PIVOT: s(-4, 9), FIXO: s(-0.5, 8), ALA_R: s(-4.5, 18) },
    carrier: 'ALA_R',
    attackFormation: '3-1',
    defendPressing: 'mid',
    counter: false,
    timeLimit: 10,
    rotation: 'isolation',
  },
}

/**
 * Demonstration: the scenario's own move only (every other family off, its own high), so the Lab
 * can show it for teaching. Normal matches never do this: they select by context.
 */
export function demoPriorities(kind: RotationKind): Partial<Record<FamilyId, FamilyPriority>> {
  const own = KIND_FAMILY[kind]
  const out: Partial<Record<FamilyId, FamilyPriority>> = {}
  for (const f of FAMILY_IDS) out[f] = f === own ? 'high' : 'off'
  return out
}

/** Scenarios added with the rotation library (the Lab test runs them in demonstration mode). */
export const LIBRARY_SCENARIOS: readonly ScenarioId[] = [
  'wingClearance',
  'threeCircle',
  'crossRun',
  'paralela',
  'thirdMan',
  'underlap',
  'pivotLayoff',
  'switchPlay',
  'wideOverload',
  'doubleCut',
  'oppositeMove',
  'diagonalRun',
  'isolation',
]

export const SCENARIO_ORDER: readonly ScenarioId[] = [
  'breakaway',
  'twoOnKeeper',
  'counter3v2',
  'baseEight',
  'baseEightWing',
  'butterfly',
  'fourCircle',
  'pivotRotation',
  'overlap',
  'wallPass',
  'backPost',
  'buildUpPress',
  ...LIBRARY_SCENARIOS,
]

function playerOf(state: MatchState, team: TeamId, role: PlayerRole): PlayerState {
  return state.players.find((p) => p.team === team && p.role === role)!
}

function resetPlayer(p: PlayerState, pos: Vec2, vel: Vec2, facing: number): void {
  p.pos = { ...pos }
  p.vel = { ...vel }
  p.facing = facing
  p.moveIntent = { x: 0, y: 0 }
  p.faceTarget = null
  p.sprint = false
  p.sole = false
  p.saveDive = false
  p.shotStartX = null
  p.shotStartOut = null
  p.touchCooldown = 0
  p.tackleCooldown = 0
  p.action = 'none'
  p.actionTime = 0
  p.buffered = null
  p.aiTarget = { ...pos }
  p.aiDecisionTimer = 0
  p.aiHoldTimer = 0
  p.aiBreakawayCorner = 0
  p.aiChallengeTimer = 0
  p.aiChallengeSide = 0
  p.dribbleTouchTimer = 0
  p.aiSetPieceTimer = 0
  p.aiRunTimer = 0
  p.aiRunCooldown = 0
  p.aiMarkId = null
  p.aiRunTarget = { ...pos }
  p.aiRecoverTimer = 0
  p.aiDecision = ''
  p.aiState = ''
  p.aiMove = null
  p.aiMoveReadyAt = 0
}

/**
 * Place the scenario into a running match: `attackTeam` gets the attacking situation. Everything
 * that could carry over from the previous attempt (a restart, a pressing jump, a rotation, AI timers,
 * the ball's flight) is cleared. The human player (if any) gets the carrier when he attacks, or the
 * defender nearest the ball when he defends.
 */
export function applyScenario(state: MatchState, sc: Scenario, attackTeam: TeamId): void {
  const defendTeam: TeamId = attackTeam === 0 ? 1 : 0
  const dir = state.teams[attackTeam].attackDir
  const goalY = dir * COURT.halfLength
  // Attackers' frame -> sim: right of an attacker facing +y is +x.
  const at = (sp: Spot): Vec2 => ({ x: sp.x * dir, y: goalY - dir * sp.d })
  const faceGoal = dir > 0 ? Math.PI / 2 : -Math.PI / 2
  const faceOwn = -faceGoal

  state.phase = 'play'
  state.phaseTimer = 0
  state.restart = null
  state.clearance = null
  state.indirectKickBy = null
  state.pressTrigger = [null, null]
  state.rotation = [null, null]
  state.rotationReadyAt = [state.time, state.time]
  // Fresh rotation bookkeeping (cooldowns, reservations, what was read of the defence), keeping
  // the statistics the Lab counts.
  state.rotationTeam = [emptyRotationTeam(), emptyRotationTeam()]
  state.defTransition = [false, false]
  state.possessionTeam = attackTeam
  state.aiPrevPossession = attackTeam
  // Settled possession, or the counter-attack window just opened.
  state.possessionSinceTick = sc.counter ? state.tick : state.tick - TICK_RATE * 10
  state.switchCooldown = 0
  state.autoSwitchHold = 0

  for (const [role, sp] of Object.entries(sc.attackers) as [OutfieldRole, Spot][]) {
    const p = playerOf(state, attackTeam, role)
    resetPlayer(p, at(sp), { x: 0, y: dir * (sp.run ?? 0) }, sp.backToGoal ? faceOwn : faceGoal)
  }
  for (const [role, sp] of Object.entries(sc.defenders) as [OutfieldRole, Spot][]) {
    const p = playerOf(state, defendTeam, role)
    resetPlayer(p, at(sp), { x: 0, y: dir * (sp.run ?? 0) }, faceOwn)
  }
  resetPlayer(playerOf(state, defendTeam, 'GK'), { x: 0, y: goalY - dir * 0.8 }, { x: 0, y: 0 }, faceOwn)
  resetPlayer(playerOf(state, attackTeam, 'GK'), { x: 0, y: -goalY + dir * 0.8 }, { x: 0, y: 0 }, faceGoal)

  const carrier = playerOf(state, attackTeam, sc.carrier)
  const b = state.ball
  b.pos = { x: carrier.pos.x, y: carrier.pos.y + dir * 0.4 }
  b.z = 0
  b.vel = { ...carrier.vel }
  b.vz = 0
  b.spin = 0
  b.mode = 'controlled'
  b.ownerId = carrier.id
  b.lastTouchId = carrier.id
  b.lastTouchTeam = attackTeam
  b.intendedReceiverId = null
  b.isShot = false
  b.kickPos = { ...b.pos }
  b.kickTime = state.time
  b.inHands = false
  b.handsTimer = 0
  b.keeperRetouchId = null
  b.shotScreen = 0
  b.shotLongRange = false
  b.shotPlaced = false
  b.lastKickerId = null
  b.blockedTouchId = null
  b.landing = null

  if (state.humanTeam !== null) {
    if (state.humanTeam === attackTeam) state.controlledId = carrier.id
    else {
      let best: PlayerState | null = null
      for (const p of state.players)
        if (p.team === defendTeam && p.role !== 'GK')
          if (!best || dist2(p.pos, carrier.pos) < dist2(best.pos, carrier.pos)) best = p
      state.controlledId = best!.id
    }
  }
}

function dist2(a: Vec2, b: Vec2): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2
}

export type ScenarioOutcome = 'goal' | 'conceded' | 'saved' | 'out' | 'lost' | 'timeout'
export const SCENARIO_OUTCOMES: readonly ScenarioOutcome[] = [
  'goal',
  'saved',
  'out',
  'lost',
  'timeout',
  'conceded',
]

/**
 * The outcome of an attempt from this tick's events, or null while it is still on. A shot that is
 * saved ends it as "saved" (a rebound tap-in is not waited for); the defenders winning the ball as
 * "lost" (their keeper catching a cross included); the time running out as "timeout".
 */
export function scenarioOutcome(
  events: readonly MatchEvent[],
  attackTeam: TeamId,
  elapsed: number,
  sc: Scenario,
): ScenarioOutcome | null {
  for (const e of events) {
    if (e.type === 'GoalScored') return e.team === attackTeam ? 'goal' : 'conceded'
    if (e.type === 'Save') return 'saved'
    if (e.type === 'BallOut') return 'out'
    if (e.type === 'PossessionChanged' && e.team !== null && e.team !== attackTeam) return 'lost'
  }
  return elapsed >= sc.timeLimit ? 'timeout' : null
}
