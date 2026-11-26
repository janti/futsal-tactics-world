import type { MatchPhase, MatchState, PlayerActionKind, PlayerRole, TeamId } from './MatchState'

/**
 * Compact render-facing copy of the authoritative state. Two preallocated snapshots (previous and
 * current tick) are interpolated by the renderer; nothing here is allocated per frame.
 */
export interface PlayerSnapshot {
  id: number
  team: TeamId
  role: PlayerRole
  x: number
  y: number
  vx: number
  vy: number
  facing: number
  action: PlayerActionKind
  actionTime: number
  hasBall: boolean
  sole: boolean
  sprint: boolean
  saveDive: boolean
}

export interface MatchSnapshot {
  tick: number
  phase: MatchPhase
  ball: {
    x: number
    y: number
    z: number
    vx: number
    vy: number
    vz: number
    owned: boolean
    inHands: boolean
  }
  players: PlayerSnapshot[]
  controlledId: number | null
  possessionTeam: TeamId | null
  /** The ball has gone out and is still flying/rolling off the court (presentation only). */
  ballOut: boolean
  /** Attack direction of each team (flips at half-time). */
  teamDirs: [1 | -1, 1 | -1]
}

export function createSnapshot(state: MatchState): MatchSnapshot {
  const snap: MatchSnapshot = {
    tick: 0,
    phase: state.phase,
    ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, owned: false, inHands: false },
    players: state.players.map((p) => ({
      id: p.id,
      team: p.team,
      role: p.role,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      facing: 0,
      action: 'none' as PlayerActionKind,
      actionTime: 0,
      hasBall: false,
      sole: false,
      sprint: false,
      saveDive: false,
    })),
    controlledId: null,
    possessionTeam: null,
    ballOut: false,
    teamDirs: [state.teams[0].attackDir, state.teams[1].attackDir],
  }
  writeSnapshot(state, snap)
  return snap
}

export function writeSnapshot(state: MatchState, out: MatchSnapshot): void {
  out.tick = state.tick
  out.phase = state.phase
  const b = state.ball
  out.ball.x = b.pos.x
  out.ball.y = b.pos.y
  out.ball.z = b.z
  out.ball.vx = b.vel.x
  out.ball.vy = b.vel.y
  out.ball.vz = b.vz
  out.ball.owned = b.ownerId !== null
  out.ball.inHands = b.inHands
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i]!
    const s = out.players[i]!
    s.x = p.pos.x
    s.y = p.pos.y
    s.vx = p.vel.x
    s.vy = p.vel.y
    s.facing = p.facing
    s.action = p.action
    s.actionTime = p.actionTime
    s.hasBall = b.ownerId === p.id
    s.sole = p.sole
    s.sprint = p.sprint
    s.saveDive = p.saveDive
  }
  out.controlledId = state.controlledId
  out.possessionTeam = state.possessionTeam
  out.ballOut = state.phase === 'restart' && state.restart !== null && !state.restart.ballPlaced
  out.teamDirs[0] = state.teams[0].attackDir
  out.teamDirs[1] = state.teams[1].attackDir
}

export function copySnapshot(from: MatchSnapshot, to: MatchSnapshot): void {
  to.tick = from.tick
  to.phase = from.phase
  Object.assign(to.ball, from.ball)
  for (let i = 0; i < from.players.length; i++) Object.assign(to.players[i]!, from.players[i]!)
  to.controlledId = from.controlledId
  to.possessionTeam = from.possessionTeam
  to.ballOut = from.ballOut
  to.teamDirs[0] = from.teamDirs[0]
  to.teamDirs[1] = from.teamDirs[1]
}
