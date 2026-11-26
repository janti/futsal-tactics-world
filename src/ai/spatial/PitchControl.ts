/**
 * Spatial grid: pitch control. The court is divided into 2 x 2 m cells; for each cell the arrival time
 * of the fastest player of each team (shared time-to-reach model) gives team 0's control 0..1 (0.5 =
 * contested). Recomputed at most five times a second and cached per match state, so it costs ~2000
 * time-to-reach estimates per update. Used for support positioning (move into space your team owns)
 * and exposed for debugging (radar overlay).
 */
import type { Vec2 } from '../../core/math/vec2'
import { estimateTimeToReach } from '../../physics/PlayerPhysics'
import type { MatchState, TeamId } from '../../simulation/MatchState'
import { COURT } from '../../simulation/SimulationConfig'

export const PITCH_GRID = {
  cell: 2,
  cols: Math.round(COURT.width / 2),
  rows: Math.round(COURT.length / 2),
} as const

/** Seconds of arrival-time advantage that give clear control (logistic slope). */
const SLOPE = 3
/** Ticks between recomputations (0.2 s). */
const REFRESH_TICKS = 12

export interface PitchControlGrid {
  tick: number
  /** Team 0 control per cell, row-major from sim y = -halfLength, x = -halfWidth. */
  team0: Float32Array
}

const cache = new WeakMap<MatchState, PitchControlGrid>()

export function cellCentre(col: number, row: number): Vec2 {
  return {
    x: -COURT.halfWidth + (col + 0.5) * PITCH_GRID.cell,
    y: -COURT.halfLength + (row + 0.5) * PITCH_GRID.cell,
  }
}

export function pitchControl(state: MatchState): PitchControlGrid {
  const cached = cache.get(state)
  if (cached && state.tick - cached.tick < REFRESH_TICKS && state.tick >= cached.tick) return cached
  const grid: PitchControlGrid = {
    tick: state.tick,
    team0: new Float32Array(PITCH_GRID.cols * PITCH_GRID.rows),
  }
  for (let row = 0; row < PITCH_GRID.rows; row++) {
    for (let col = 0; col < PITCH_GRID.cols; col++) {
      const c = cellCentre(col, row)
      let t0 = Infinity
      let t1 = Infinity
      for (const p of state.players) {
        const t = estimateTimeToReach(p, c)
        if (p.team === 0) t0 = Math.min(t0, t)
        else t1 = Math.min(t1, t)
      }
      grid.team0[row * PITCH_GRID.cols + col] = 1 / (1 + Math.exp(-(t1 - t0) * SLOPE))
    }
  }
  cache.set(state, grid)
  return grid
}

/** Control of `team` at a point (nearest cell, clamped to the court). */
export function controlAt(state: MatchState, team: TeamId, pos: Vec2): number {
  const g = pitchControl(state)
  const col = Math.min(
    PITCH_GRID.cols - 1,
    Math.max(0, Math.floor((pos.x + COURT.halfWidth) / PITCH_GRID.cell)),
  )
  const row = Math.min(
    PITCH_GRID.rows - 1,
    Math.max(0, Math.floor((pos.y + COURT.halfLength) / PITCH_GRID.cell)),
  )
  const v = g.team0[row * PITCH_GRID.cols + col]!
  return team === 0 ? v : 1 - v
}
