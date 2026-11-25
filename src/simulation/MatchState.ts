import type { Difficulty } from './Difficulty'
import type { Vec2 } from '../core/math/vec2'
import type { ControlOptions } from './ControlOptions'
import type { MatchRules, TeamStats } from './MatchRules'

export type TeamId = 0 | 1
export type AttackDir = 1 | -1

export type PlayerRole = 'GK' | 'FIXO' | 'ALA_L' | 'ALA_R' | 'PIVOT'

/** All attributes on a 1–100 scale. */
export interface PlayerAttributes {
  // technical
  passing: number
  firstTouch: number
  ballControl: number
  dribbling: number
  soleControl: number
  finishing: number
  shotPower: number
  shotAccuracy: number
  weakFoot: number
  tackling: number
  interception: number
  pivotPlay: number
  // physical
  acceleration: number
  sprintSpeed: number
  agility: number
  balance: number
  strength: number
  stamina: number
  reactionSpeed: number
  recovery: number
  // mental
  decisions: number
  anticipation: number
  vision: number
  composure: number
  positioning: number
  teamwork: number
  workRate: number
  creativity: number
  tacticalIntelligence: number
  concentration: number
  // goalkeeping
  reflexes: number
  handling: number
  gkPositioning: number
  oneOnOne: number
  diving: number
  throwing: number
  distribution: number
  footwork: number
}

export interface PlayerProfile {
  id: number
  firstName: string
  lastName: string
  nationality: string
  age: number
  heightCm: number
  weightKg: number
  preferredFoot: 'left' | 'right'
  shirtNumber: number
  position: PlayerRole
  attributes: PlayerAttributes
  /** Appearance (visual only). */
  skinTone: number
  hairColor: number
  hairStyle: number
}

export type PlayerActionKind = 'none' | 'pass' | 'shot' | 'throw' | 'tackle' | 'save' | 'receive'

export interface PlayerState {
  id: number
  team: TeamId
  role: PlayerRole
  profile: PlayerProfile
  pos: Vec2
  vel: Vec2
  /** Facing angle in sim space (atan2 of the facing vector). */
  facing: number
  /** Desired movement, magnitude 0..1. Written by input or AI, consumed by movement physics. */
  moveIntent: Vec2
  /** Optional explicit facing target (e.g. face the ball while shuffling). */
  faceTarget: Vec2 | null
  sprint: boolean
  sole: boolean
  stamina: number
  /** Seconds before this player can touch the ball again. */
  touchCooldown: number
  tackleCooldown: number
  /** Current visible action, for animation and rules. */
  action: PlayerActionKind
  actionTime: number
  /** Buffered human action (executed when the player gains control within the buffer window). */
  buffered: BufferedAction | null
  /** AI bookkeeping. */
  aiTarget: Vec2
  aiDecisionTimer: number
  aiHoldTimer: number
  /** Corner chosen for the current breakaway finish (-1 / 1 sim x side, 0 = none). */
  aiBreakawayCorner: number
  /** 1v1 dribble challenge in progress: time left and the side (sim x sign) he goes past on. */
  aiChallengeTimer: number
  aiChallengeSide: number
  /** Time until the next sprint-dribble touch is possible. */
  dribbleTouchTimer: number
  /** Set-piece shooter: time left to strike the routine pass first time. */
  aiSetPieceTimer: number
  aiState: string
}

export type BufferedAction =
  | { kind: 'pass'; through: boolean; dir: Vec2; ttl: number; power?: number }
  | { kind: 'shot'; power: number; dir: Vec2; ttl: number }

export type BallMode = 'free' | 'controlled' | 'dead'

export interface BallState {
  pos: Vec2
  z: number
  vel: Vec2
  vz: number
  /** Side spin approximation (rad/s, positive curves left of travel direction). */
  spin: number
  mode: BallMode
  ownerId: number | null
  lastTouchId: number | null
  lastTouchTeam: TeamId | null
  /** Player id the current pass is intended for. */
  intendedReceiverId: number | null
  /** True while the last kick was a shot (used by goalkeeper and statistics). */
  isShot: boolean
  /** Where the ball was last kicked from (flight distance gives the keeper reaction time). */
  kickPos: Vec2
  /** Simulation time of the last kick. */
  kickTime: number
  /**
   * The goalkeeper holds the ball in their hands (after a save, or gathering an opponent's ball in
   * their own penalty area). Opponents cannot challenge it. A back pass from a teammate is played
   * with the feet instead, like an outfield player.
   */
  inHands: boolean
  /** Seconds the keeper has had the ball (hands or feet) in the own half: four-second rule. */
  handsTimer: number
  /**
   * Keeper who released the ball in the own half and may not touch it again there until an opponent
   * has touched it (futsal second-possession rule), or null.
   */
  keeperRetouchId: number | null
  /**
   * For the current shot: how much the keeper's view was screened at the moment of the shot
   * (0 = clear view, 1 = fully screened), and whether it was a long-range or tight-angle shot.
   */
  shotScreen: number
  shotLongRange: boolean
  /** The current shot is a quick low placed shot (a tap): the keeper cannot hold it. */
  shotPlaced: boolean
  /**
   * Player whose deliberate kick (pass, shot, kick-in...) last played the ball, or null after a
   * deflection, save or block. A keeper may not handle a ball deliberately kicked to him by a teammate.
   */
  lastKickerId: number | null
  /**
   * Set-piece taker who may not touch the ball again until another player has touched it
   * (no double touch after a kick-in, corner or kick-off).
   */
  blockedTouchId: number | null
}

export type RestartType = 'kickoff' | 'kickIn' | 'corner' | 'goalClearance' | 'freeKick'

export interface RestartInfo {
  type: RestartType
  team: TeamId
  spot: Vec2
  takerId: number
  timer: number
  /**
   * The taker is at the ball and play restarts only when the ball is kicked: kick-ins, corners and
   * kick-offs cannot be dribbled.
   */
  ready: boolean
  /** Seconds since the restart became ready (four-second rule for kick-ins and corners). */
  readyTimer: number
  /**
   * Direction the taker is aiming the restart (unit vector). The taker stands behind the ball along
   * this direction, so turning the aim walks him around the ball while the ball stays on the line.
   */
  aimDir: Vec2
  /**
   * False while the ball that went out is still flying/rolling off the court (to the boards and
   * back); it is then placed on the restart spot.
   */
  ballPlaced: boolean
  /** AI set-piece routine: player ids for the short man, the pivot and the deep man (fixed once). */
  routineIds?: number[]
}

export type MatchPhase = 'restart' | 'play' | 'goal' | 'halftime' | 'fulltime'

export interface TeamState {
  id: TeamId
  name: string
  shortName: string
  primaryColor: number
  secondaryColor: number
  numberColor: number
  attackDir: AttackDir
}

export interface MatchState {
  tick: number
  /** Simulation time in seconds since kick-off of the session. */
  time: number
  /** Effective playing time (clock stops when the ball is dead). */
  playingTime: number
  /** Current half (1 or 2). */
  half: 1 | 2
  /** Match clock: seconds remaining in the current half. */
  clock: number
  rules: MatchRules
  /** Team that kicked off the first half (the other team kicks off the second). */
  firstKickoffTeam: TeamId
  stats: [TeamStats, TeamStats]
  phase: MatchPhase
  phaseTimer: number
  restart: RestartInfo | null
  teams: [TeamState, TeamState]
  score: [number, number]
  players: PlayerState[]
  ball: BallState
  /** Human-controlled team, or null for AI vs AI. */
  humanTeam: TeamId | null
  controlledId: number | null
  switchCooldown: number
  /** After a manual switch, automatic defensive switching pauses for this long (seconds). */
  autoSwitchHold: number
  control: ControlOptions
  /**
   * Taker of an indirect free kick until another player touches the ball: a goal scored straight
   * from it does not count (goal clearance instead).
   */
  indirectKickBy: number | null
  /**
   * AI: a team caught out of shape after losing the ball (counter-attack against it): a goal-side
   * player presses, the others sprint back to their men, until the attackers play the ball back, the
   * ball goes dead or the team is back in shape.
   */
  defTransition: [boolean, boolean]
  /** AI bookkeeping: possession seen on the previous AI update. */
  aiPrevPossession: TeamId | null
  /** Strength of the computer opponent (affects only the non-human team). */
  difficulty: Difficulty
  possessionTeam: TeamId | null
  rngState: number
}
