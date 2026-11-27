import { OrthographicCamera } from 'three'
import { clamp, damp } from '../core/math/scalar'
import type { MatchSnapshot } from '../simulation/MatchSnapshot'
import type { AttackDir } from '../simulation/MatchState'
import { clampTargetY, computeFrustum } from './CameraFraming'
import { CAMERA_PRESETS, type CameraPresetId, type CameraSettings } from './CameraSettings'
import { basisFromCamera, type ScreenBasis } from './ScreenToWorld'

/** Metres the ball is always kept inside the frame edge. */
const BALL_EDGE_MARGIN = 1.5
/** Furthest look-ahead (m) along the ball's path that the frame keeps in view. */
const LEAD_MAX = 6

export interface CameraFocus {
  ballX: number
  ballY: number
  ballVx: number
  ballVy: number
  /** Ball height (m): a high ball is drawn further up the screen in the vertical views. */
  ballZ?: number
  controlledY: number | null
  /** Attack direction of the team in possession, or 0 if contested. */
  possessionDir: number
}

/**
 * Vertical Smart camera: orthographic, fixed elevation, predictive tracking along the court length,
 * full court width always visible, frame-rate independent exponential damping, no roll and no
 * automatic rotation on possession changes.
 */
export class CameraController {
  readonly camera: OrthographicCamera
  settings: CameraSettings
  /**
   * The human team's attacking direction (sim y) as presented: towards the top of the screen in the
   * vertical views, towards the right in the horizontal ones.
   */
  upSign: AttackDir = 1
  private aspect = 16 / 9
  private targetY = 0
  private goalY = 0
  private visibleLength: number
  private basis: ScreenBasis

  constructor(preset: CameraPresetId = 'verticalSmart') {
    this.settings = { ...CAMERA_PRESETS[preset] }
    this.visibleLength = this.settings.visibleLength
    this.camera = new OrthographicCamera(-10, 10, 10, -10, 0.1, 400)
    this.applyProjection()
    this.applyPose()
    this.basis = basisFromCamera(this.camera)
  }

  setPreset(id: CameraPresetId): void {
    this.settings = { ...CAMERA_PRESETS[id] }
  }

  /** Use explicit settings (the Camera Lab's custom camera). */
  setSettings(settings: CameraSettings): void {
    this.settings = { ...settings }
  }

  setAspect(aspect: number): void {
    this.aspect = aspect
    this.applyProjection()
  }

  getBasis(): ScreenBasis {
    return this.basis
  }

  /** Snap to the target immediately (match start, preset change in a stoppage). */
  snap(focus: CameraFocus): void {
    this.visibleLength = this.settings.visibleLength
    this.goalY = this.desiredY(focus)
    this.targetY = this.goalY
    this.applyProjection()
    this.applyPose()
  }

  update(focus: CameraFocus, dt: number): void {
    const s = this.settings
    this.visibleLength = damp(this.visibleLength, s.visibleLength, s.zoomSmoothing, dt)
    this.applyProjection()
    const desired = this.desiredY(focus)
    // Dead zone: ignore small target changes (minor bounces, dribble touches).
    const diff = desired - this.goalY
    if (Math.abs(diff) > s.deadZone) this.goalY = desired - Math.sign(diff) * s.deadZone
    this.targetY = damp(this.targetY, this.goalY, s.positionSmoothing, dt)
    // The damping lags a fast ball (a quick ball up the court, a long throw): never let it leave the
    // frame. The view is pushed along with the ball once it gets close to an edge.
    if (!s.fixed) this.targetY = this.keepBallInView(this.targetY, focus)
    this.applyPose()
  }

  /** Ball position along the length as drawn: in the vertical views height shows as screen-up. */
  private ballScreenY(f: CameraFocus): number {
    if (this.settings.orientation === 'horizontal' || !f.ballZ) return f.ballY
    const e = (this.settings.elevationDeg * Math.PI) / 180
    return f.ballY + (this.upSign * f.ballZ) / Math.tan(e)
  }

  /**
   * Hard limit: the ball stays at least `BALL_EDGE_MARGIN` inside the frame (more on the side it is
   * travelling towards, so the receiver and the space it is played into are seen too).
   */
  private keepBallInView(y: number, f: CameraFocus): number {
    const half = this.frustum().visibleLength / 2
    const by = this.ballScreenY(f)
    const lead = clamp(f.ballVy * 0.35, -LEAD_MAX, LEAD_MAX)
    const hi = Math.max(by, by + lead) // furthest point that must be visible towards +y
    const lo = Math.min(by, by + lead)
    const edge = half - BALL_EDGE_MARGIN
    let out = y
    if (hi > out + edge) out = hi - edge
    if (lo < out - edge) out = lo + edge
    return clampTargetY(out, this.frustum().visibleLength)
  }

  private desiredY(f: CameraFocus): number {
    const s = this.settings
    const frustum = this.frustum()
    if (s.fixed) return 0
    let y = f.ballY + f.ballVy * s.lookAhead + f.possessionDir * s.attackBias
    // Keep the controlled player on screen whenever physically possible.
    if (f.controlledY !== null) {
      const half = frustum.visibleLength / 2 - 3
      if (f.controlledY > y + half) y = f.controlledY - half
      if (f.controlledY < y - half) y = f.controlledY + half
    }
    // ...but never at the cost of losing the ball: a fast ball is kept well inside the frame on the
    // side it travels to (where the play goes), not at the edge behind a deep controlled player.
    const by = this.ballScreenY(f)
    const lead = clamp(f.ballVy * 0.6, -LEAD_MAX, LEAD_MAX)
    const ballHalf = frustum.visibleLength / 2 - 2.5
    y = Math.min(Math.max(y, Math.max(by, by + lead) - ballHalf), Math.min(by, by + lead) + ballHalf)
    return clampTargetY(y, frustum.visibleLength)
  }

  private frustum() {
    const s = this.settings
    return computeFrustum(this.aspect, this.visibleLength, s.elevationDeg, s.sideMargin, s.orientation)
  }

  private applyProjection(): void {
    const f = this.frustum()
    this.camera.left = -f.width / 2
    this.camera.right = f.width / 2
    this.camera.top = f.height / 2
    this.camera.bottom = -f.height / 2
    this.camera.updateProjectionMatrix()
  }

  private applyPose(): void {
    const e = (this.settings.elevationDeg * Math.PI) / 180
    const distance = 120
    // Three.js: X = sim x, Y = height, Z = sim y. Camera sits "below" the screen-up direction.
    const tx = 0
    const tz = this.targetY
    if (this.settings.orientation === 'horizontal') {
      // Side view from a touch line: looking along +X the screen right is +Z (sim +y), so the camera
      // stands on the -X side when the human attacks +y (and on +X otherwise) — attack to the right.
      this.camera.position.set(-this.upSign * Math.cos(e) * distance, Math.sin(e) * distance, tz)
    } else this.camera.position.set(tx, Math.sin(e) * distance, tz - this.upSign * Math.cos(e) * distance)
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(tx, 0, tz)
    this.camera.updateMatrixWorld()
    this.basis = basisFromCamera(this.camera)
  }

  /** Court bounds currently visible (for tests / radar viewport). */
  visibleRange(): { minY: number; maxY: number; width: number } {
    const f = this.frustum()
    return {
      minY: this.targetY - f.visibleLength / 2,
      maxY: this.targetY + f.visibleLength / 2,
      width: f.width,
    }
  }
}

/**
 * Which end is shown at the top of the screen. With `keepHumanAttackingUp` (default) the presentation
 * rotates 180 degrees at half-time so the human team always attacks upwards; otherwise the initial
 * orientation is kept and the human team attacks downwards in the second half (traditional).
 */
export function presentationUpSign(
  humanTeam: 0 | 1 | null,
  teamDirs: readonly [AttackDir, AttackDir],
  keepHumanAttackingUp: boolean,
  initialUpSign: AttackDir,
): AttackDir {
  if (humanTeam === null || !keepHumanAttackingUp) return initialUpSign
  return teamDirs[humanTeam]
}

export function focusFromSnapshot(s: MatchSnapshot, teamDirs: [AttackDir, AttackDir]): CameraFocus {
  const controlled = s.controlledId !== null ? s.players[s.controlledId]! : null
  const contested = !s.ball.owned
  const possessionDir = s.possessionTeam === null ? 0 : teamDirs[s.possessionTeam] * (contested ? 0.4 : 1)
  // Ball out over a goal line: frame the end of the hall so the flight to the boards is visible.
  const overEnd = s.ballOut && Math.abs(s.ball.y) > 18
  return {
    ballX: s.ball.x,
    ballY: overEnd ? Math.sign(s.ball.y) * 24 : s.ball.y,
    ballVx: s.ball.vx,
    ballVy: overEnd ? 0 : s.ball.vy,
    ballZ: overEnd ? 0 : s.ball.z,
    // While a ball that went out is still travelling, follow the ball alone (to the boards and back).
    controlledY: controlled && !s.ballOut ? controlled.y : null,
    possessionDir,
  }
}
