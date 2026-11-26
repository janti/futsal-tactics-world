import { TEAM_LIBRARY } from '../data/teams'
import {
  defaultBindings,
  rebind,
  sanitizeBindings,
  type InputAction,
  type KeyBindings,
} from '../input/InputMapping'
import { isDifficulty, type Difficulty } from '../simulation/Difficulty'
import { create } from 'zustand'
import {
  CAMERA_PRESET_ORDER,
  sanitizeCustomCamera,
  type CameraPresetId,
  type CameraSettings,
} from '../camera/CameraSettings'
import { isGraphicsPreset, type GraphicsPreset } from '../rendering/ThreeRenderer'
import type { Lang, TranslationKey } from '../localization/i18n'
import type { MatchPhase, RestartType } from '../simulation/MatchState'
import { HALF_LENGTH_OPTIONS, type HalfLengthMinutes, type TeamStats } from '../simulation/MatchRules'
import {
  DEFAULT_CONTROL_OPTIONS,
  isDefensiveSwitchMode,
  type ControlOptions,
  isPassAssistMode,
} from '../simulation/ControlOptions'

/**
 * UI state only. Positions and other per-tick simulation data never live here; the game loop pushes
 * HUD values at ~10 Hz.
 */
export interface HudState {
  homeName: string
  awayName: string
  homeShort: string
  awayShort: string
  homeColor: string
  awayColor: string
  score: [number, number]
  clock: number
  phase: MatchPhase
  restartType: RestartType | null
  half: 1 | 2
  controlledName: string | null
  controlledNumber: number | null
  controlledRole: string | null
  shotCharge: number
  /** Seconds left to take a ready kick-in or corner (four-second rule), else null. */
  restartCountdown: number | null
  /** Seconds the human keeper may still keep the ball (four-second rule), else null. */
  keeperCountdown: number | null
  /** Keeper has the ball in the hands (throw) rather than at the feet. */
  keeperHands: boolean
}

export interface QuickMatchSetup {
  homeIndex: number
  awayIndex: number
  halfMinutes: HalfLengthMinutes
  effectiveClock: boolean
  difficulty: Difficulty
}

export interface MatchResult {
  score: [number, number]
  names: [string, string]
  colors: [string, string]
  stats: [TeamStats, TeamStats]
}

export interface Flash {
  key: TranslationKey
  vars?: Record<string, string | number>
  until: number
  /** Small info toast instead of the big centre flash. */
  info?: boolean
}

export interface UiState {
  screen: 'title' | 'setup' | 'match'
  lang: Lang
  paused: boolean
  showHelp: boolean
  cameraPreset: CameraPresetId
  /** Player control preferences (persisted; applied to the running match immediately). */
  controls: ControlOptions
  /** Presentation: keep your team attacking up the screen in both halves. */
  keepAttackingUp: boolean
  /** Player visual size (1 = true size; larger values improve readability). */
  playerScale: number
  /** Quick Match setup (persisted). */
  quickMatch: QuickMatchSetup
  /** Keyboard bindings (persisted). */
  keyBindings: KeyBindings
  /** Camera Lab: the player's custom camera (persisted) and whether the lab panel is open. */
  customCamera: CameraSettings
  cameraLabOpen: boolean
  /** Radar / minimap on screen (persisted). */
  showRadar: boolean
  /** Graphics quality (persisted; applied when a match starts). */
  graphics: GraphicsPreset
  /** Result of the finished match (end screen), or null. */
  result: MatchResult | null
  matchKey: number
  hud: HudState
  flash: Flash | null
  setLang(lang: Lang): void
  startMatch(): void
  restartMatch(): void
  quitToTitle(): void
  setPaused(p: boolean): void
  toggleHelp(): void
  setCameraPreset(id: CameraPresetId): void
  setControls(c: Partial<ControlOptions>): void
  setKeepAttackingUp(v: boolean): void
  setPlayerScale(v: number): void
  setQuickMatch(q: Partial<QuickMatchSetup>): void
  setCustomCamera(c: Partial<CameraSettings>): void
  toggleCameraLab(): void
  setShowRadar(v: boolean): void
  setGraphics(g: GraphicsPreset): void
  setKeyBinding(action: InputAction, code: string): void
  resetKeyBindings(): void
  openSetup(): void
  setResult(r: MatchResult | null): void
  setHud(h: Partial<HudState>): void
  showFlash(f: Flash | null): void
}

const LANG_KEY = 'ftw.lang'
const CAMERA_KEY = 'ftw.camera'
const CONTROLS_KEY = 'ftw.controls'
const PRESENTATION_KEY = 'ftw.keepAttackingUp'
const PLAYER_SCALE_KEY = 'ftw.playerScale'
const KEYS_KEY = 'ftw.keys'
const CUSTOM_CAMERA_KEY = 'ftw.customCamera'
const RADAR_KEY = 'ftw.radar'
const GRAPHICS_KEY = 'ftw.graphics'

function loadCustomCamera(): CameraSettings {
  try {
    const raw = localStorage.getItem(CUSTOM_CAMERA_KEY)
    if (raw) return sanitizeCustomCamera(JSON.parse(raw))
  } catch {
    /* storage unavailable or invalid JSON */
  }
  return sanitizeCustomCamera(null)
}

function loadRadar(): boolean {
  try {
    return localStorage.getItem(RADAR_KEY) !== 'false'
  } catch {
    return true
  }
}

function loadGraphics(): GraphicsPreset {
  try {
    const v = localStorage.getItem(GRAPHICS_KEY)
    if (isGraphicsPreset(v)) return v
  } catch {
    /* storage unavailable */
  }
  return 'high'
}

function loadKeyBindings(): KeyBindings {
  try {
    const raw = localStorage.getItem(KEYS_KEY)
    if (raw) return sanitizeBindings(JSON.parse(raw))
  } catch {
    /* storage unavailable or invalid JSON */
  }
  return defaultBindings()
}

function loadPlayerScale(): number {
  try {
    const v = Number(localStorage.getItem(PLAYER_SCALE_KEY))
    if ([1, 1.06, 1.12].includes(v)) return v
  } catch {
    /* default */
  }
  return 1.12
}
const QUICK_KEY = 'ftw.quickMatch'

const DEFAULT_QUICK: QuickMatchSetup = {
  homeIndex: 0,
  awayIndex: 1,
  halfMinutes: 3,
  effectiveClock: true,
  difficulty: 'normal',
}

function loadQuickMatch(teamCount = TEAM_LIBRARY.length): QuickMatchSetup {
  try {
    const raw = localStorage.getItem(QUICK_KEY)
    if (raw) {
      const v = JSON.parse(raw) as Partial<QuickMatchSetup>
      const idx = (n: unknown, d: number) => (typeof n === 'number' && n >= 0 && n < teamCount ? n : d)
      const q: QuickMatchSetup = {
        homeIndex: idx(v.homeIndex, 0),
        awayIndex: idx(v.awayIndex, 1),
        halfMinutes: HALF_LENGTH_OPTIONS.includes(v.halfMinutes as HalfLengthMinutes)
          ? (v.halfMinutes as HalfLengthMinutes)
          : 3,
        effectiveClock: typeof v.effectiveClock === 'boolean' ? v.effectiveClock : true,
        difficulty: isDifficulty(v.difficulty) ? v.difficulty : 'normal',
      }
      if (q.homeIndex === q.awayIndex) q.awayIndex = (q.homeIndex + 1) % teamCount
      return q
    }
  } catch {
    /* use defaults */
  }
  return { ...DEFAULT_QUICK }
}

function loadKeepAttackingUp(): boolean {
  try {
    return localStorage.getItem(PRESENTATION_KEY) !== 'false'
  } catch {
    return true
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

function loadControls(): ControlOptions {
  try {
    const raw = localStorage.getItem(CONTROLS_KEY)
    if (raw) {
      const v = JSON.parse(raw) as Partial<ControlOptions>
      return {
        ...DEFAULT_CONTROL_OPTIONS,
        ...(isDefensiveSwitchMode(v.defensiveSwitch) ? { defensiveSwitch: v.defensiveSwitch } : {}),
        ...(isPassAssistMode(v.passAssist) ? { passAssist: v.passAssist } : {}),
      }
    }
  } catch {
    /* storage unavailable or invalid JSON: use defaults */
  }
  return { ...DEFAULT_CONTROL_OPTIONS }
}

function loadLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY)
    if (v === 'fi' || v === 'en') return v
    return navigator.language?.toLowerCase().startsWith('fi') ? 'fi' : 'en'
  } catch {
    return 'en'
  }
}

function loadCamera(): CameraPresetId {
  try {
    const v = localStorage.getItem(CAMERA_KEY)
    if ((CAMERA_PRESET_ORDER as (string | null)[]).includes(v)) return v as CameraPresetId
  } catch {
    /* storage unavailable */
  }
  return 'verticalSmart'
}

export const useUi = create<UiState>((set) => ({
  screen: 'title',
  lang: loadLang(),
  paused: false,
  showHelp: false,
  cameraPreset: loadCamera(),
  controls: loadControls(),
  keepAttackingUp: loadKeepAttackingUp(),
  playerScale: loadPlayerScale(),
  quickMatch: loadQuickMatch(),
  keyBindings: loadKeyBindings(),
  customCamera: loadCustomCamera(),
  cameraLabOpen: false,
  showRadar: loadRadar(),
  graphics: loadGraphics(),
  result: null,
  matchKey: 0,
  hud: {
    homeName: '',
    awayName: '',
    homeShort: '',
    awayShort: '',
    homeColor: '#1f5fbf',
    awayColor: '#d23a2f',
    score: [0, 0],
    clock: 0,
    phase: 'restart',
    restartType: null,
    half: 1,
    controlledName: null,
    controlledNumber: null,
    controlledRole: null,
    shotCharge: 0,
    restartCountdown: null,
    keeperCountdown: null,
    keeperHands: false,
  },
  flash: null,
  setLang: (lang) => {
    try {
      localStorage.setItem(LANG_KEY, lang)
    } catch {
      /* ignore */
    }
    set({ lang })
  },
  startMatch: () =>
    set((s) => ({ screen: 'match', paused: false, matchKey: s.matchKey + 1, flash: null, result: null })),
  restartMatch: () => set((s) => ({ paused: false, matchKey: s.matchKey + 1, flash: null, result: null })),
  quitToTitle: () => set({ screen: 'title', paused: false, flash: null, result: null, cameraLabOpen: false }),
  setPaused: (paused) => set({ paused }),
  toggleHelp: () => set((s) => ({ showHelp: !s.showHelp })),
  setCameraPreset: (cameraPreset) => {
    try {
      localStorage.setItem(CAMERA_KEY, cameraPreset)
    } catch {
      /* ignore */
    }
    set({ cameraPreset })
  },
  setControls: (c) =>
    set((s) => {
      const controls = { ...s.controls, ...c }
      try {
        localStorage.setItem(CONTROLS_KEY, JSON.stringify(controls))
      } catch {
        /* ignore */
      }
      return { controls }
    }),
  setPlayerScale: (playerScale) => {
    save(PLAYER_SCALE_KEY, String(playerScale))
    set({ playerScale })
  },
  setKeepAttackingUp: (keepAttackingUp) => {
    save(PRESENTATION_KEY, String(keepAttackingUp))
    set({ keepAttackingUp })
  },
  setQuickMatch: (q) =>
    set((s) => {
      const quickMatch = { ...s.quickMatch, ...q }
      save(QUICK_KEY, JSON.stringify(quickMatch))
      return { quickMatch }
    }),
  setCustomCamera: (c) =>
    set((s) => {
      const customCamera = sanitizeCustomCamera({ ...s.customCamera, ...c })
      save(CUSTOM_CAMERA_KEY, JSON.stringify(customCamera))
      return { customCamera }
    }),
  toggleCameraLab: () => set((s) => ({ cameraLabOpen: !s.cameraLabOpen })),
  setShowRadar: (showRadar) => {
    save(RADAR_KEY, String(showRadar))
    set({ showRadar })
  },
  setGraphics: (graphics) => {
    save(GRAPHICS_KEY, graphics)
    set({ graphics })
  },
  setKeyBinding: (action, code) =>
    set((s) => {
      const keyBindings = rebind(s.keyBindings, action, code)
      save(KEYS_KEY, JSON.stringify(keyBindings))
      return { keyBindings }
    }),
  resetKeyBindings: () => {
    save(KEYS_KEY, JSON.stringify(defaultBindings()))
    set({ keyBindings: defaultBindings() })
  },
  openSetup: () => set({ screen: 'setup', paused: false, flash: null, result: null }),
  setResult: (result) => set({ result }),
  setHud: (h) => set((s) => ({ hud: { ...s.hud, ...h } })),
  showFlash: (flash) => set({ flash }),
}))
