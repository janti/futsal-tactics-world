/**
 * Runtime types of the rotation library: the active coordinated move per team (one slot), its
 * statistics, space reservations, the observed defending of the opponent and individual moves.
 * Immutable definitions are in rotationLibrary.ts.
 */
import type { Vec2 } from '../../core/math/vec2'
import type { FamilyId, IndividualKind, MovementKind, RotationKind } from './rotationLibrary'
import { MOVEMENT_KINDS } from './rotationLibrary'

/**
 * `run`: attacks space and is the one the ball should reach (its arrival completes the move);
 * `wall`: the 1-2 partner; `link`: the third-man link who plays the runner in first time;
 * `cover`: fills the space left behind (or clears a space as a decoy); `drop`: comes short to show;
 * `post`: takes a spot in front of goal and strikes first time; `carry`: the receiver carries the
 * ball to the target (inside, into the middle); `switch`: the receiver plays it on at once to
 * `passTo`.
 */
export type RotationJob = 'run' | 'wall' | 'link' | 'cover' | 'drop' | 'post' | 'carry' | 'switch'

export interface RotationMove {
  id: number
  job: RotationJob
  target: Vec2
  /** A runner goes this way first (e.g. up the middle before going out to the wing). */
  via?: Vec2
  viaDone?: boolean
  /** `switch` / `link`: the teammate the ball goes on to. */
  passTo?: number
  /** Simulation time the move starts (staggered runs); before it he holds his support spot. */
  startAt?: number
  /** Where he stood when the move started (vacated space). */
  origin?: Vec2
}

/**
 * State of the active move. Candidate, preparing and committed happen in the selection step
 * (rotationSelect.ts); `preparing` here is a short familiarity-dependent delay before the runs go,
 * then `executing`; `opportunity` once a runner is free with an open lane. After the end the team is
 * `recovering` / in `cooldown` (RotationTeamState.phase).
 */
export type RotationStatus = 'preparing' | 'executing' | 'opportunity'

/** How the marker of the first runner reacted (read about a second after the start). */
export type DefenderResponse = 'pending' | 'followed' | 'held' | 'handedOver' | 'none'

export type EndReason =
  | 'reachedRunner'
  | 'pivot'
  | 'returned'
  | 'cycle'
  | 'timeUp'
  | 'otherReceiver'
  | 'possessionLost'
  | 'ballDead'
  | 'replaced'
  | 'noSpace'
  | 'humanControl'
  | 'tacticsChanged'

export interface Rotation {
  kind: RotationKind
  /** Unique per team and match. */
  instance: number
  /** The carrier the rotation is built round (the wall pass: the passer, who is also the runner). */
  carrierId: number
  moves: RotationMove[]
  /** Simulation time it started / ends at the latest. */
  started: number
  until: number
  /** Back-post rotation: the men have swapped. */
  swapped: boolean
  /** Wall pass / third man: the wall (link) has had the ball. */
  wallTouched: boolean
  status: RotationStatus
  /** Utility it was selected with and the "keep the shape" score it beat. */
  score: number
  stay: number
  /** What started it (for the AI view). */
  trigger: string
  /** Runner id -> his marker at the start, and where that marker stood. */
  markers: { runner: number; marker: number; from: Vec2 }[]
  response: DefenderResponse
  /** Decision branch taken (e.g. wing clearance: "attackVacated"). */
  branch: string | null
  /** Best alternatives that lost the selection. */
  rejected: { kind: RotationKind; score: number }[]
  opportunityCounted: boolean
  displacedCounted: boolean
}

export interface RotationStats {
  started: number
  completed: number
  cancelled: number
  /** A runner got free with an open lane (OpportunityCreated). */
  opportunities: number
  /** A runner's marker was pulled away from where he stood (space created, also by decoys). */
  displaced: number
  /** Shots / goals by the team during the move or within 5 s of its end. */
  shotsAfter: number
  goalsAfter: number
  /** Possession lost during the move. */
  turnovers: number
  /** Opponent shots within 8 s of a turnover during the move. */
  counterShots: number
  reasons: Partial<Record<EndReason, number>>
}

export function emptyStats(): RotationStats {
  return {
    started: 0,
    completed: 0,
    cancelled: 0,
    opportunities: 0,
    displaced: 0,
    shotsAfter: 0,
    goalsAfter: 0,
    turnovers: 0,
    counterShots: 0,
    reasons: {},
  }
}

export function emptyRotationStats(): Record<MovementKind, RotationStats> {
  const out = {} as Record<MovementKind, RotationStats>
  for (const k of MOVEMENT_KINDS) out[k] = emptyStats()
  return out
}

/** A space a teammate is going to use: steers the others' target choice, not a physical obstacle. */
export interface Reservation {
  playerId: number
  instance: number
  purpose: RotationJob
  center: Vec2
  radius: number
  /** Estimated arrival (simulation time) and expiry. */
  eta: number
  until: number
  priority: number
}

/**
 * What a team has observed of the opponent's defending while it had the ball (positions only):
 * `follow` 0..1 — how often a marker went with an attacker who moved (man-oriented ~1, zonal ~0);
 * `block` 0..1 — how deep their block sits (team-relative depth of their outfield players from
 * our goal: high press ~0.75, low block ~0.25).
 */
export interface DefenceRead {
  follow: number
  block: number
  samples: number
  lastAt: number
  snap: { attacker: number; pos: Vec2; marker: number }[]
}

export interface RotationTeamState {
  nextInstance: number
  /** Next scheduled team selection (about 5 Hz; a pass triggers one at once). */
  nextSelectAt: number
  familyReadyAt: Partial<Record<FamilyId, number>>
  /** Recent starts (repetition penalty). */
  recent: { family: FamilyId; time: number }[]
  last: { kind: RotationKind; reason: EndReason; completed: boolean; time: number } | null
  phase: 'idle' | 'active' | 'recovering' | 'cooldown'
  recoverUntil: number
  reservations: Reservation[]
  read: DefenceRead
  /** Last selection (AI view): the stay-in-shape score and the best candidates. */
  lastEval: { time: number; stay: number; candidates: { kind: RotationKind; score: number }[] } | null
  /** Possession lost during a move: when, and which move. */
  lossAt: number
  lossKind: RotationKind | null
  /** Shot / goal attribution: the move to credit and until when. */
  creditKind: RotationKind | null
  creditUntil: number
  shotSeen: boolean
  goalsSeen: number
}

export function emptyRotationTeam(): RotationTeamState {
  return {
    nextInstance: 1,
    nextSelectAt: 0,
    familyReadyAt: {},
    recent: [],
    last: null,
    phase: 'idle',
    recoverUntil: 0,
    reservations: [],
    read: { follow: 0.6, block: 0.5, samples: 0, lastAt: 0, snap: [] },
    lastEval: null,
    lossAt: -Infinity,
    lossKind: null,
    creditKind: null,
    creditUntil: -Infinity,
    shotSeen: false,
    goalsSeen: 0,
  }
}

/** Individual movement of one player (no team slot). */
export interface IndividualMove {
  kind: IndividualKind
  /** V-cut: 0 = the step away, 1 = the burst into the receiving spot. */
  phase: 0 | 1
  until: number
  /** Where he wants to receive / the first step away. */
  spot: Vec2
  fake: Vec2
  markerId: number
  /** Marker distance when the move started (did he bite on the step away?). */
  markerDist: number
  received: boolean
}
