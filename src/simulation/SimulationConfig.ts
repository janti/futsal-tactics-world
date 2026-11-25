/**
 * Static simulation configuration. Court geometry follows the standard 40 x 20 m futsal court.
 * Physics values are initial tuning values for playtesting, not final.
 */

export const TICK_RATE = 60
export const DT = 1 / TICK_RATE
/** Never simulate more than this much real time per rendered frame (prevents catch-up spirals). */
export const MAX_FRAME_TIME = 0.25

export const COURT = {
  length: 40,
  width: 20,
  halfLength: 20,
  halfWidth: 10,
  goalWidth: 3,
  goalHalfWidth: 1.5,
  goalHeight: 2,
  goalDepth: 1,
  postSize: 0.08,
  centerCircleRadius: 3,
  /** Penalty area: quarter circles of this radius centred on the outside of each post, joined by a straight line. */
  penaltyAreaRadius: 6,
  penaltyMark: 6,
  secondPenaltyMark: 10,
  cornerArcRadius: 0.25,
  /** Players may run a little outside the lines (run-off area); the ball is dead once fully across. */
  runOff: 1.6,
} as const

/**
 * Arena surroundings the ball can hit after leaving the court (presentation only: the ball is already
 * out of play). Shared with the renderer so the boards are drawn where the ball bounces.
 */
export const ARENA = {
  /** Advertising boards behind the goal lines and along the touch lines (inner faces). */
  boardEndY: COURT.halfLength + 4 - 0.06,
  boardSideX: COURT.halfWidth + 3.6 - 0.06,
  boardHeight: 0.85,
  /** Hall end walls and the front of the stands, for balls flying over the boards. */
  endWallY: COURT.halfLength + 8 - 0.15,
  sideWallX: COURT.halfWidth + 5,
  restitution: 0.45,
  /** Tangential speed kept on impact. */
  friction: 0.85,
} as const

/** Post centre offset from the court centre line along x (inner goal width + half a post). */
export const POST_X = COURT.goalHalfWidth + COURT.postSize / 2
/** Posts sit on the goal line; their centres are half a post behind it. */
export const POST_Y = COURT.halfLength + COURT.postSize / 2
export const POST_RADIUS = COURT.postSize / 2
export const CROSSBAR_Z = COURT.goalHeight + COURT.postSize / 2

export const BALL = {
  radius: 0.1,
  gravity: 9.81,
  /** Constant rolling deceleration on the floor (m/s^2). Futsal balls are heavy and roll "dead". */
  rollingDecel: 1.6,
  /** Linear rolling drag (1/s), adds speed-proportional loss. */
  rollingDrag: 0.12,
  /** Quadratic air drag coefficient (1/m). */
  airDrag: 0.012,
  /** Vertical restitution on floor bounce (futsal ball: low bounce). */
  restitution: 0.42,
  /** Horizontal speed retained per bounce. */
  bounceFriction: 0.88,
  /** Below this downward speed the ball stops bouncing and rolls. */
  minBounceSpeed: 0.9,
  postRestitution: 0.65,
  /** Max distance travelled per collision substep (continuous collision approximation). */
  maxSubstepDistance: 0.05,
  maxSubsteps: 16,
  /** Lateral acceleration per unit spin per unit speed (curve). */
  magnus: 0.05,
  spinDecay: 1.2,
} as const

export const PLAYER = {
  radius: 0.32,
  goalkeeperRadius: 0.38,
  /** Reach of the goalkeeper's hands/legs for saves. */
  goalkeeperReach: 0.95,
  /** Extra reach when diving at a shot (aiState 'save'); saves at full stretch are harder. */
  goalkeeperDiveReach: 1.25,
  /** Keeper movement speed cap (m/s): a keeper cannot sprint across the goal like an outfield player. */
  goalkeeperMaxSpeed: 5,
  /** Reaction delay to a shot (s), from the reflexes attribute (worst..best). */
  goalkeeperReaction: [0.3, 0.14] as const,
  goalkeeperReachHeight: 2.35,
  /** Lateral shuffle keeps most of the keeper's speed (keepers are trained to move sideways). */
  goalkeeperShuffleFactor: 0.92,
  /** Normal (jog/run) speed range from the sprint-speed attribute. */
  runSpeed: [3.6, 4.6] as const,
  sprintSpeed: [6.2, 7.8] as const,
  acceleration: [9, 14] as const,
  deceleration: 18,
  turnRate: [9, 15] as const,
  soleSpeed: 1.7,
  withBallSpeedFactor: 0.9,
  /** Speed multiplier when moving sideways/backwards relative to facing. */
  backpedalFactor: 0.72,
  /** Players may touch the ball up to this height. */
  ballContactHeight: 0.75,
  kickCooldown: 0.25,
  tackleCooldown: 0.8,
  tackleDuration: 0.3,
  switchCooldown: 0.25,
} as const

/** Ball held in the keeper's hands: carried in front of the chest. */
export const HANDS = {
  /** Ball held at chest height in front of the keeper (underside height; arms reach it with bent elbows). */
  forward: 0.3,
  height: 0.98,
  /** A human keeper may hold the ball this long before the AI distributes it. */
  holdLimit: 4,
} as const

/**
 * Long-range / tight-angle shots and screening ("maski"). With a clear view the keeper deals with
 * almost every shot from 10 m or more (or from a tight angle); a player in his line of sight hides the
 * shot, delays his reaction and makes such shots dangerous.
 */
export const SCREEN = {
  /** Shots from at least this far from the goal centre count as long range. */
  longRange: 10,
  /** Shots where the goal mouth subtends less than this angle (radians) count as tight-angle. */
  tightAngle: 0.24,
  /** A player within this distance of the keeper's line of sight screens it. */
  lineWidth: 0.85,
  /** Save probability for an unscreened long-range shot the keeper can reach. */
  clearSave: 0.97,
  /** Save probability for a fully screened one. */
  screenedSave: 0.45,
  /** Extra keeper reaction delay (seconds) for a fully screened shot. */
  reactionDelay: 0.28,
} as const

/** Goalkeeper throw controlled by the player. */
export const THROW = {
  minSpeed: 7,
  /** Maximum speed range from the throwing attribute (worst..best). */
  maxSpeed: [17, 22] as const,
  maxChargeTime: 0.8,
  /** Above this power the throw is overarm (in the air); below it is bowled along the floor. */
  overarmPower: 0.35,
  /** Vertical launch speed range for overarm throws: a longer press gives a higher arc. */
  minVz: 2.6,
  maxVz: 8.8,
  arcCurve: 1.1,
  releaseHeight: 1.3,
  /** Angular error (radians) from the throwing attribute (worst..best). */
  error: [0.09, 0.015] as const,
} as const

export const CONTROL = {
  /** Distance from player centre at which a free ball can be controlled. */
  pickupRadius: 0.52,
  /** Dribble: ball offset in front of the player at rest and per m/s of speed. */
  dribbleOffset: 0.4,
  dribbleOffsetPerSpeed: 0.05,
  soleOffset: 0.26,
  /** Control is lost if the ball drifts further than this from its owner. */
  loseDistance: 1.3,
  /** Relative speeds below this are always controlled cleanly. */
  cleanControlSpeed: 7,
  /** Relative speeds above this cannot be controlled (ball deflects). */
  maxControlSpeed: 17,
  /** Base steal rate per second for an opponent touching the dribbled ball. */
  stealRate: 3.2,
  tackleStealChance: 0.75,
  inputBufferTime: 0.13,
  /** Sprint dribbling is touch-based: above this speed the ball is knocked ahead in touches. */
  touchDribbleSpeed: 5.2,
  /** Next touch only when the ball is back within this distance in front of the feet. */
  touchReach: 0.62,
  /** Minimum time between sprint touches (s). */
  touchInterval: 0.28,
  /** Between touches the ball rolls at this fraction of the runner's speed, so he catches it up. */
  touchRollRatio: 0.86,
  /** A knocked-ahead ball is lost beyond this distance. */
  touchLoseDistance: 2.3,
  /** Opponents win a ball that is away from the dribbler's feet much more easily. */
  looseBallStealFactor: 3,
  /** Shielding: steal rate factor when the dribbler's body is between the opponent and the ball. */
  shieldFactor: [0.5, 0.2] as const,
} as const

export const PASS = {
  arrivalSpeed: 5,
  throughArrivalSpeed: 6.5,
  minSpeed: 6,
  maxSpeed: 19,
  maxAngleErrorRad: 0.07,
  assistConeCos: Math.cos((65 * Math.PI) / 180),
  /** Semi-assisted passing only picks a teammate within this angle of the input. */
  semiAssistConeCos: Math.cos((28 * Math.PI) / 180),
  /** Manual passing: power of a quick tap; holding the button charges up to full power. */
  manualDefaultPower: 0.3,
  manualMaxChargeTime: 0.7,
  throughLead: 3.5,
} as const

export const SHOT = {
  maxSpeed: 29,
  /** Holding the button longer than this fires a full-power shot automatically. */
  maxChargeTime: 0.75,
  aimInsidePost: 0.32,
  /** A tap (power up to this) is a quick, low, placed shot into the corner. */
  placedMaxPower: 0.32,
  /** Placed shots aim closer to the post and travel at this speed range (skill worst..best). */
  placedInsidePost: 0.22,
  placedSpeed: [19, 23] as const,
  /** Underside height of a placed shot at the goal (skims just above the floor). */
  placedHeight: 0.08,
  /** Height at the goal for a full charge: over the 2 m crossbar. */
  fullChargeHeight: 2.85,
  /** Heavy futsal ball: height grows slowly with charge at first (exponent > 1). */
  heightCurve: 1.7,
} as const

export const RESTART = {
  /** Opponent distance at kick-ins, corners and free kicks (metres). */
  opponentDistance: 5,
  celebrationTime: 2.6,
  minRestartDelay: 0.8,
  /** Kick-ins and corners must be taken within this time once the taker is ready. */
  kickTimeLimit: 4,
  /**
   * After the ball goes out it keeps flying (to the boards, bouncing back) before it is placed on the
   * restart spot: at least the minimum time, then once it has slowed down, at most the maximum.
   */
  outFlightMin: 1.0,
  outFlightMax: 3.2,
  outSettledSpeed: 1.5,
  /** After this long a player still out of position for a kick-off is walked back automatically. */
  kickoffGrace: 6,
} as const

export const SWITCHING = {
  /** Nearest-player mode: another player must be this much closer to the ball before control moves. */
  nearestHysteresis: 1.0,
  /** Minimum time between automatic switches (prevents flicker). */
  autoCooldown: 0.4,
  /** Automatic switching pauses this long after a manual switch. */
  manualHold: 1.5,
} as const
