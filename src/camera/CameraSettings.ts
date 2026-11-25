/** Camera tuning values (initial values from CAMERA_DESIGN.md; adjustable in the future Camera Lab). */
export interface CameraSettings {
  name: CameraPresetId
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

export type CameraPresetId = 'verticalSmart' | 'verticalClassic' | 'verticalFullCourt' | 'verticalCloseAction'

export const CAMERA_PRESETS: Record<CameraPresetId, CameraSettings> = {
  verticalSmart: {
    name: 'verticalSmart',
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
}

export const CAMERA_PRESET_ORDER: CameraPresetId[] = [
  'verticalSmart',
  'verticalClassic',
  'verticalFullCourt',
  'verticalCloseAction',
]
