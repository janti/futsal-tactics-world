/** Camera tuning values (initial values from CAMERA_DESIGN.md; adjustable live in the Camera Lab). */
export interface CameraSettings {
  name: CameraPresetId
  /**
   * `vertical`: the court length runs up the screen (your team attacks upwards).
   * `horizontal`: broadcast-style side view, the length runs across the screen (you attack right).
   */
  orientation: CameraOrientation
  elevationDeg: number
  /** Court length visible on screen (metres). */
  visibleLength: number
  minVisibleLength: number
  maxVisibleLength: number
  /** Seconds of ball velocity to look ahead. */
  lookAhead: number
  /** Maximum shift towards the attacking direction of the team in possession (metres). */
  attackBias: number
  positionSmoothing: number
  zoomSmoothing: number
  deadZone: number
  /** Fixed cameras do not track the ball. */
  fixed: boolean
  /** Extra margin kept visible beside the touch lines (metres, each side). */
  sideMargin: number
}

export type CameraOrientation = 'vertical' | 'horizontal'

export type CameraPresetId =
  | 'verticalSmart'
  | 'verticalClassic'
  | 'verticalFullCourt'
  | 'verticalCloseAction'
  | 'horizontalTactical'
  | 'horizontalFullCourt'
  | 'custom'

export const CAMERA_PRESETS: Record<CameraPresetId, CameraSettings> = {
  verticalSmart: {
    name: 'verticalSmart',
    orientation: 'vertical',
    elevationDeg: 78,
    visibleLength: 27,
    minVisibleLength: 22,
    maxVisibleLength: 44,
    lookAhead: 0.25,
    attackBias: 3,
    positionSmoothing: 0.18,
    zoomSmoothing: 0.5,
    deadZone: 1,
    fixed: false,
    sideMargin: 1.6,
  },
  verticalClassic: {
    name: 'verticalClassic',
    orientation: 'vertical',
    elevationDeg: 88,
    visibleLength: 26,
    minVisibleLength: 22,
    maxVisibleLength: 44,
    lookAhead: 0,
    attackBias: 0,
    positionSmoothing: 0.25,
    zoomSmoothing: 0.5,
    deadZone: 0.5,
    fixed: false,
    sideMargin: 1.6,
  },
  verticalFullCourt: {
    name: 'verticalFullCourt',
    orientation: 'vertical',
    elevationDeg: 86,
    visibleLength: 44,
    minVisibleLength: 22,
    maxVisibleLength: 46,
    lookAhead: 0,
    attackBias: 0,
    positionSmoothing: 0.3,
    zoomSmoothing: 0.5,
    deadZone: 0,
    fixed: true,
    sideMargin: 1.6,
  },
  verticalCloseAction: {
    name: 'verticalCloseAction',
    orientation: 'vertical',
    elevationDeg: 70,
    visibleLength: 22,
    minVisibleLength: 18,
    maxVisibleLength: 44,
    lookAhead: 0.3,
    attackBias: 2.5,
    positionSmoothing: 0.16,
    zoomSmoothing: 0.5,
    deadZone: 0.8,
    fixed: false,
    sideMargin: 1.2,
  },
  horizontalTactical: {
    name: 'horizontalTactical',
    orientation: 'horizontal',
    elevationDeg: 62,
    visibleLength: 30,
    minVisibleLength: 22,
    maxVisibleLength: 46,
    lookAhead: 0.25,
    attackBias: 3,
    positionSmoothing: 0.2,
    zoomSmoothing: 0.5,
    deadZone: 1,
    fixed: false,
    sideMargin: 1.4,
  },
  horizontalFullCourt: {
    name: 'horizontalFullCourt',
    orientation: 'horizontal',
    elevationDeg: 58,
    visibleLength: 44,
    minVisibleLength: 22,
    maxVisibleLength: 48,
    lookAhead: 0,
    attackBias: 0,
    positionSmoothing: 0.3,
    zoomSmoothing: 0.5,
    deadZone: 0,
    fixed: true,
    sideMargin: 1.4,
  },
  // Starting point of the Camera Lab's custom camera (the player's own values are stored separately).
  custom: {
    name: 'custom',
    orientation: 'vertical',
    elevationDeg: 78,
    visibleLength: 27,
    minVisibleLength: 16,
    maxVisibleLength: 48,
    lookAhead: 0.25,
    attackBias: 3,
    positionSmoothing: 0.18,
    zoomSmoothing: 0.5,
    deadZone: 1,
    fixed: false,
    sideMargin: 1.6,
  },
}

/** Ranges for the Camera Lab sliders. */
export const CAMERA_LAB_RANGES = {
  elevationDeg: [45, 90, 1],
  visibleLength: [16, 48, 0.5],
  lookAhead: [0, 0.8, 0.05],
  attackBias: [0, 6, 0.25],
  positionSmoothing: [0.05, 0.6, 0.01],
  deadZone: [0, 3, 0.1],
  sideMargin: [0, 4, 0.1],
} as const satisfies Partial<Record<keyof CameraSettings, readonly [number, number, number]>>

/** Validate stored custom camera values; anything missing or out of range falls back to defaults. */
export function sanitizeCustomCamera(v: unknown): CameraSettings {
  const base: CameraSettings = { ...CAMERA_PRESETS.custom }
  if (!v || typeof v !== 'object') return base
  const o = v as Record<string, unknown>
  if (o.orientation === 'vertical' || o.orientation === 'horizontal') base.orientation = o.orientation
  if (typeof o.fixed === 'boolean') base.fixed = o.fixed
  for (const [k, [lo, hi]] of Object.entries(CAMERA_LAB_RANGES) as [
    keyof typeof CAMERA_LAB_RANGES,
    readonly [number, number, number],
  ][]) {
    const n = o[k]
    if (typeof n === 'number' && Number.isFinite(n)) base[k] = Math.min(hi, Math.max(lo, n))
  }
  return base
}

export const CAMERA_PRESET_ORDER: CameraPresetId[] = [
  'verticalSmart',
  'verticalClassic',
  'verticalFullCourt',
  'verticalCloseAction',
  'horizontalTactical',
  'horizontalFullCourt',
  'custom',
]
