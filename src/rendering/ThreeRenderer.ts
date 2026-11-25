import { ACESFilmicToneMapping, Color, Fog, Scene, SRGBColorSpace, WebGLRenderer } from 'three'
import { CameraController, focusFromSnapshot, presentationUpSign } from '../camera/CameraController'
import type { CameraPresetId } from '../camera/CameraSettings'
import type { MatchSnapshot } from '../simulation/MatchSnapshot'
import type { MatchState } from '../simulation/MatchState'
import { BallRenderer } from './BallRenderer'
import { createCourt } from './CourtRenderer'
import { GoalRenderer } from './GoalRenderer'
import { createLighting, type ShadowQuality } from './LightingSystem'
import { PlayerRenderer } from './PlayerRenderer'
import { createBlobTexture } from './textures'

export interface GraphicsOptions {
  maxPixelRatio: number
  shadows: ShadowQuality
  antialias: boolean
  crowdDensity: number
}

export const GRAPHICS_PRESETS = {
  low: { maxPixelRatio: 1, shadows: 'off', antialias: false, crowdDensity: 0.3 },
  medium: { maxPixelRatio: 1.5, shadows: 'low', antialias: true, crowdDensity: 0.7 },
  high: { maxPixelRatio: 2, shadows: 'high', antialias: true, crowdDensity: 1 },
} as const satisfies Record<string, GraphicsOptions>

export type GraphicsPreset = keyof typeof GRAPHICS_PRESETS
export const DEFAULT_GRAPHICS: GraphicsOptions = GRAPHICS_PRESETS.high

/** Graphics preset from the `?gfx=low|medium|high` URL parameter (full settings UI arrives in Milestone 4). */
export function graphicsFromUrl(search: string): GraphicsOptions {
  const v = new URLSearchParams(search).get('gfx')
  return v === 'low' || v === 'medium' || v === 'high' ? GRAPHICS_PRESETS[v] : DEFAULT_GRAPHICS
}

/**
 * Owns the WebGL renderer, scene and camera. Reads interpolated snapshots only — it never writes
 * simulation state, and nothing in the simulation depends on it.
 */
export class ThreeRenderer {
  readonly renderer: WebGLRenderer
  readonly scene = new Scene()
  readonly cameraController: CameraController
  private readonly players: PlayerRenderer
  private readonly goals: GoalRenderer
  private readonly ball: BallRenderer
  private readonly humanTeam: 0 | 1 | null
  private readonly initialUpSign: 1 | -1
  /** Rotate the presentation at half-time so the human team keeps attacking upwards. */
  keepHumanAttackingUp = true
  private readonly container: HTMLElement
  private readonly resizeObserver: ResizeObserver
  private snapped = false

  constructor(container: HTMLElement, state: MatchState, options: GraphicsOptions = DEFAULT_GRAPHICS) {
    this.container = container
    this.renderer = new WebGLRenderer({ antialias: options.antialias, powerPreference: 'high-performance' })
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.0
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, options.maxPixelRatio))
    this.renderer.domElement.setAttribute('data-testid', 'game-canvas')
    container.appendChild(this.renderer.domElement)

    this.scene.background = new Color(0x141c25)
    this.scene.fog = new Fog(0x141c25, 140, 220)
    this.scene.add(createLighting(this.renderer, options.shadows))
    this.scene.add(createCourt(this.renderer, options.crowdDensity))
    this.goals = new GoalRenderer()
    this.scene.add(this.goals.group)
    const blob = createBlobTexture()
    this.players = new PlayerRenderer(state, blob)
    this.scene.add(this.players.group)
    this.ball = new BallRenderer(blob)
    this.scene.add(this.ball.group)

    this.cameraController = new CameraController('verticalSmart')
    this.humanTeam = state.humanTeam
    this.initialUpSign = state.humanTeam !== null ? state.teams[state.humanTeam].attackDir : 1
    this.cameraController.upSign = this.initialUpSign

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
  }

  /** Player visual size multiplier (1 = true size). Collision sizes are unaffected. */
  setPlayerScale(k: number): void {
    this.players.setVisualScale(k)
  }

  setCameraPreset(id: CameraPresetId): void {
    this.cameraController.setPreset(id)
  }

  resize(): void {
    const w = Math.max(1, this.container.clientWidth)
    const h = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(w, h, false)
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    this.cameraController.setAspect(w / h)
  }

  /** `throwAim`: throw charge 0..1 while the human keeper holds the ball in the hands, else null. */
  render(
    prev: MatchSnapshot,
    curr: MatchSnapshot,
    alpha: number,
    dt: number,
    throwAim: number | null = null,
  ): void {
    this.players.update(prev, curr, alpha, dt, throwAim)
    this.ball.update(prev, curr, alpha)
    const bc = this.ball.center
    this.goals.update(bc.x, bc.y, bc.z, dt)
    this.ball.offset(this.goals.ballOffset)
    const focus = focusFromSnapshot(curr, curr.teamDirs)
    const up = presentationUpSign(
      this.humanTeam,
      curr.teamDirs,
      this.keepHumanAttackingUp,
      this.initialUpSign,
    )
    if (up !== this.cameraController.upSign) {
      // Ends changed (half-time) or the setting changed: rotate the view during the stoppage.
      this.cameraController.upSign = up
      this.snapped = false
    }
    if (!this.snapped) {
      this.cameraController.snap(focus)
      this.snapped = true
    } else {
      this.cameraController.update(focus, dt)
    }
    this.renderer.render(this.scene, this.cameraController.camera)
  }

  get drawCalls(): number {
    return this.renderer.info.render.calls
  }

  dispose(): void {
    this.resizeObserver.disconnect()
    this.players.dispose()
    this.scene.traverse((o) => {
      const mesh = o as {
        geometry?: { dispose(): void }
        material?: { dispose(): void } | { dispose(): void }[]
      }
      mesh.geometry?.dispose()
      const m = mesh.material
      if (Array.isArray(m)) m.forEach((x) => x.dispose())
      else m?.dispose()
    })
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
