import type { Vec2 } from '../core/math/vec2'
import type { RestartType, TeamId } from './MatchState'

export type MatchEvent =
  | { type: 'PassStarted'; tick: number; playerId: number; receiverId: number | null; through: boolean }
  | { type: 'PassCompleted'; tick: number; playerId: number; receiverId: number }
  | { type: 'BallIntercepted'; tick: number; playerId: number; team: TeamId }
  | { type: 'ShotTaken'; tick: number; playerId: number; team: TeamId; speed: number }
  | { type: 'Save'; tick: number; playerId: number; caught: boolean }
  | { type: 'PostHit'; tick: number; speed: number }
  | { type: 'WallHit'; tick: number; speed: number }
  | { type: 'BallKicked'; tick: number; playerId: number; speed: number }
  | { type: 'BallBounced'; tick: number; speed: number }
  | { type: 'Tackle'; tick: number; playerId: number; success: boolean }
  | { type: 'GoalScored'; tick: number; team: TeamId; scorerId: number | null; score: [number, number] }
  | { type: 'BallOut'; tick: number; restart: RestartType; team: TeamId; spot: Vec2 }
  | { type: 'PossessionChanged'; tick: number; team: TeamId | null }
  | { type: 'PlayerSwitched'; tick: number; playerId: number }
  | { type: 'PlayResumed'; tick: number }
  | { type: 'HalfTime'; tick: number; score: [number, number] }
  | { type: 'SecondHalfStarted'; tick: number }
  | { type: 'MatchFinished'; tick: number; score: [number, number] }
  | { type: 'KeeperThrow'; tick: number; playerId: number; power: number; receiverId: number | null }
  /** The human keeper held the ball too long; the AI distributes it instead. */
  | { type: 'KeeperHoldTimeout'; tick: number; playerId: number }
  /** A kick-in or corner was not taken within four seconds; the restart goes to the opponents. */
  | { type: 'RestartTimeout'; tick: number; restart: RestartType; team: TeamId }
