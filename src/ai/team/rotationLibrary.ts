/**
 * The rotation and off-ball movement library (Milestone 6): immutable definitions of the 25
 * movement families, the runtime kinds that implement them, formation profiles, team rotation
 * settings and presets. Runtime state lives in `MatchState.rotation` (see rotations.ts); selection
 * in rotationSelect.ts. Nothing here changes during a match.
 *
 * A **family** is the futsal concept (e.g. pohjakasi); a **kind** is what the engine runs. Most
 * families have one kind; pohjakasi has two (from the middle / from the wing), and a few families
 * are individual movements (no team slot) or carrier actions.
 */
import type { Formation } from '../../simulation/Tactics'

export type FamilyId =
  | 'wingClearance'
  | 'baseEight'
  | 'fourEight'
  | 'crossRun'
  | 'diagonalRotation'
  | 'parallelRotation'
  | 'threeRotation'
  | 'fourRotation'
  | 'paralela'
  | 'diagonalRun'
  | 'wallPass'
  | 'thirdMan'
  | 'backPost'
  | 'overlap'
  | 'underlap'
  | 'pivotLayoff'
  | 'pivotExchange'
  | 'doubleCut'
  | 'vCut'
  | 'oppositeMove'
  | 'wideOverload'
  | 'switchPlay'
  | 'pisada'
  | 'isolation'
  | 'betweenLines'

export const FAMILY_IDS: readonly FamilyId[] = [
  'wingClearance',
  'baseEight',
  'fourEight',
  'crossRun',
  'diagonalRotation',
  'parallelRotation',
  'threeRotation',
  'fourRotation',
  'paralela',
  'diagonalRun',
  'wallPass',
  'thirdMan',
  'backPost',
  'overlap',
  'underlap',
  'pivotLayoff',
  'pivotExchange',
  'doubleCut',
  'vCut',
  'oppositeMove',
  'wideOverload',
  'switchPlay',
  'pisada',
  'isolation',
  'betweenLines',
]

/** Rotations of the formation: continuous off-ball movement started by the pass to a side. */
export type PatternKind =
  | 'baseEight'
  | 'baseEightWing'
  | 'butterfly'
  | 'fourCircle'
  | 'threeCircle'
  | 'diagonalRotation'
  | 'parallelRotation'

/** Coordinated two- to four-man moves started where space opens (one team slot). */
export type CombinationKind =
  | 'wallPass'
  | 'overlap'
  | 'pivot'
  | 'backPost'
  | 'wingClearance'
  | 'crossRun'
  | 'paralela'
  | 'diagonalRun'
  | 'thirdMan'
  | 'underlap'
  | 'pivotLayoff'
  | 'doubleCut'
  | 'oppositeMove'
  | 'wideOverload'
  | 'switchPlay'
  | 'pisada'
  | 'isolation'

/** Individual movements: no team slot, they respect the slot's jobs and reservations. */
export type IndividualKind = 'vCut' | 'betweenLines'

export type RotationKind = PatternKind | CombinationKind
export type MovementKind = RotationKind | IndividualKind

export const PATTERN_KINDS: readonly PatternKind[] = [
  'baseEight',
  'baseEightWing',
  'butterfly',
  'fourCircle',
  'threeCircle',
  'diagonalRotation',
  'parallelRotation',
]
export const COMBINATION_KINDS: readonly CombinationKind[] = [
  'wallPass',
  'overlap',
  'pivot',
  'backPost',
  'wingClearance',
  'crossRun',
  'paralela',
  'diagonalRun',
  'thirdMan',
  'underlap',
  'pivotLayoff',
  'doubleCut',
  'oppositeMove',
  'wideOverload',
  'switchPlay',
  'pisada',
  'isolation',
]
export const INDIVIDUAL_KINDS: readonly IndividualKind[] = ['vCut', 'betweenLines']
export const ROTATION_KINDS: readonly RotationKind[] = [...PATTERN_KINDS, ...COMBINATION_KINDS]
export const MOVEMENT_KINDS: readonly MovementKind[] = [...ROTATION_KINDS, ...INDIVIDUAL_KINDS]

/** Shared building blocks (documented in FUTSAL_ROTATIONS.md; one implementation each). */
export type Primitive =
  | 'passTrigger'
  | 'runWithEta'
  | 'refillVacancy'
  | 'decoy'
  | 'layoffSupport'
  | 'laneCheck'
  | 'delayedStart'
  | 'firstTimeLink'
  | 'carrierAction'
  | 'individual'

export type MatchPhaseTag = 'buildUp' | 'midcourt' | 'finalThird'

export interface FamilyDefinition {
  id: FamilyId
  /** Runtime kinds that implement the family. */
  kinds: readonly MovementKind[]
  type: 'pattern' | 'combination' | 'individual' | 'carrier'
  /** Selection weight per formation (1 = native, below 1 possible but less likely; never a ban). */
  formations: Readonly<Record<Formation, number>>
  phases: readonly MatchPhaseTag[]
  /** Participant jobs used (see RotationJob). */
  roles: readonly string[]
  primitives: readonly Primitive[]
  /** 0..1: chance-of-losing-the-ball estimate used by the selection. */
  risk: number
  /** 0..1: how much coordination it needs (scaled by familiarity). */
  coordination: number
  /** Seconds before the same family may start again (scaled by the settings). */
  cooldown: number
}

const F = (a: number, b: number, c: number): Record<Formation, number> => ({ '3-1': a, '4-0': b, '2-2': c })

export const FAMILIES: Readonly<Record<FamilyId, FamilyDefinition>> = {
  wingClearance: {
    id: 'wingClearance',
    kinds: ['wingClearance'],
    type: 'combination',
    formations: F(1.1, 1, 1),
    phases: ['buildUp', 'midcourt'],
    roles: ['run', 'cover'],
    primitives: ['decoy', 'refillVacancy', 'runWithEta'],
    risk: 0.25,
    coordination: 0.45,
    cooldown: 3,
  },
  baseEight: {
    id: 'baseEight',
    kinds: ['baseEight', 'baseEightWing'],
    type: 'pattern',
    formations: F(1.2, 0.8, 0.6),
    phases: ['buildUp', 'midcourt'],
    roles: ['run', 'carry', 'switch', 'cover'],
    primitives: ['passTrigger', 'runWithEta', 'refillVacancy'],
    risk: 0.15,
    coordination: 0.4,
    cooldown: 0,
  },
  fourEight: {
    id: 'fourEight',
    kinds: ['butterfly'],
    type: 'pattern',
    formations: F(0.7, 1.25, 0.7),
    phases: ['buildUp', 'midcourt'],
    roles: ['run', 'carry', 'cover'],
    primitives: ['passTrigger', 'runWithEta', 'refillVacancy'],
    risk: 0.15,
    coordination: 0.45,
    cooldown: 0,
  },
  crossRun: {
    id: 'crossRun',
    kinds: ['crossRun'],
    type: 'combination',
    formations: F(0.9, 1.2, 1.15),
    phases: ['midcourt', 'finalThird'],
    roles: ['run'],
    primitives: ['runWithEta', 'delayedStart', 'decoy'],
    risk: 0.35,
    coordination: 0.6,
    cooldown: 4,
  },
  diagonalRotation: {
    id: 'diagonalRotation',
    kinds: ['diagonalRotation'],
    type: 'pattern',
    formations: F(0.9, 1.15, 0.9),
    phases: ['buildUp', 'midcourt'],
    roles: ['run', 'cover'],
    primitives: ['passTrigger', 'runWithEta', 'refillVacancy'],
    risk: 0.25,
    coordination: 0.45,
    cooldown: 0,
  },
  parallelRotation: {
    id: 'parallelRotation',
    kinds: ['parallelRotation'],
    type: 'pattern',
    formations: F(0.85, 1.15, 1),
    phases: ['buildUp', 'midcourt'],
    roles: ['run', 'carry', 'cover'],
    primitives: ['passTrigger', 'runWithEta', 'refillVacancy'],
    risk: 0.2,
    coordination: 0.4,
    cooldown: 0,
  },
  threeRotation: {
    id: 'threeRotation',
    kinds: ['threeCircle'],
    type: 'pattern',
    formations: F(1.2, 0.6, 0.5),
    phases: ['buildUp', 'midcourt'],
    roles: ['run', 'carry', 'cover'],
    primitives: ['passTrigger', 'runWithEta', 'refillVacancy'],
    risk: 0.15,
    coordination: 0.45,
    cooldown: 0,
  },
  fourRotation: {
    id: 'fourRotation',
    kinds: ['fourCircle'],
    type: 'pattern',
    formations: F(0.6, 1.25, 0.7),
    phases: ['buildUp', 'midcourt'],
    roles: ['run', 'cover'],
    primitives: ['passTrigger', 'runWithEta', 'refillVacancy'],
    risk: 0.15,
    coordination: 0.5,
    cooldown: 0,
  },
  paralela: {
    id: 'paralela',
    kinds: ['paralela'],
    type: 'combination',
    formations: F(1.1, 1.1, 1.15),
    phases: ['midcourt', 'finalThird'],
    roles: ['run', 'cover'],
    primitives: ['runWithEta', 'laneCheck'],
    risk: 0.3,
    coordination: 0.35,
    cooldown: 3,
  },
  diagonalRun: {
    id: 'diagonalRun',
    kinds: ['diagonalRun'],
    type: 'combination',
    formations: F(1.1, 1.1, 1),
    phases: ['midcourt', 'finalThird'],
    roles: ['run'],
    primitives: ['runWithEta', 'laneCheck'],
    risk: 0.3,
    coordination: 0.3,
    cooldown: 3,
  },
  wallPass: {
    id: 'wallPass',
    kinds: ['wallPass'],
    type: 'combination',
    formations: F(1, 1, 1.2),
    phases: ['buildUp', 'midcourt', 'finalThird'],
    roles: ['run', 'wall'],
    primitives: ['firstTimeLink', 'runWithEta', 'carrierAction'],
    risk: 0.3,
    coordination: 0.3,
    cooldown: 2,
  },
  thirdMan: {
    id: 'thirdMan',
    kinds: ['thirdMan'],
    type: 'combination',
    formations: F(1.2, 1.05, 1),
    phases: ['buildUp', 'midcourt', 'finalThird'],
    roles: ['link', 'run'],
    primitives: ['firstTimeLink', 'runWithEta', 'carrierAction'],
    risk: 0.3,
    coordination: 0.6,
    cooldown: 3,
  },
  backPost: {
    id: 'backPost',
    kinds: ['backPost'],
    type: 'combination',
    formations: F(1.1, 1, 1),
    phases: ['finalThird'],
    roles: ['post', 'run'],
    primitives: ['runWithEta'],
    risk: 0.2,
    coordination: 0.35,
    cooldown: 2,
  },
  overlap: {
    id: 'overlap',
    kinds: ['overlap'],
    type: 'combination',
    formations: F(0.9, 1, 1.15),
    phases: ['midcourt', 'finalThird'],
    roles: ['run', 'cover'],
    primitives: ['runWithEta', 'refillVacancy'],
    risk: 0.3,
    coordination: 0.35,
    cooldown: 2,
  },
  underlap: {
    id: 'underlap',
    kinds: ['underlap'],
    type: 'combination',
    formations: F(0.9, 1.1, 1.1),
    phases: ['midcourt', 'finalThird'],
    roles: ['run', 'cover'],
    primitives: ['runWithEta', 'refillVacancy'],
    risk: 0.3,
    coordination: 0.35,
    cooldown: 3,
  },
  pivotLayoff: {
    id: 'pivotLayoff',
    kinds: ['pivotLayoff'],
    type: 'combination',
    formations: F(1.25, 0.9, 1.1),
    phases: ['midcourt', 'finalThird'],
    roles: ['drop', 'post'],
    primitives: ['layoffSupport', 'carrierAction'],
    risk: 0.2,
    coordination: 0.35,
    cooldown: 2,
  },
  pivotExchange: {
    id: 'pivotExchange',
    kinds: ['pivot'],
    type: 'combination',
    formations: F(1.2, 1.05, 1.1),
    phases: ['midcourt', 'finalThird'],
    roles: ['drop', 'run'],
    primitives: ['refillVacancy', 'runWithEta'],
    risk: 0.2,
    coordination: 0.4,
    cooldown: 2,
  },
  doubleCut: {
    id: 'doubleCut',
    kinds: ['doubleCut'],
    type: 'combination',
    formations: F(0.85, 1.15, 1.1),
    phases: ['midcourt', 'finalThird'],
    roles: ['run'],
    primitives: ['runWithEta', 'decoy'],
    risk: 0.45,
    coordination: 0.5,
    cooldown: 5,
  },
  vCut: {
    id: 'vCut',
    kinds: ['vCut'],
    type: 'individual',
    formations: F(1, 1, 1),
    phases: ['buildUp', 'midcourt', 'finalThird'],
    roles: [],
    primitives: ['individual'],
    risk: 0.05,
    coordination: 0,
    cooldown: 4,
  },
  oppositeMove: {
    id: 'oppositeMove',
    kinds: ['oppositeMove'],
    type: 'combination',
    formations: F(1, 1.05, 1.2),
    phases: ['midcourt', 'finalThird'],
    roles: ['drop', 'run'],
    primitives: ['runWithEta', 'decoy'],
    risk: 0.25,
    coordination: 0.4,
    cooldown: 3,
  },
  wideOverload: {
    id: 'wideOverload',
    kinds: ['wideOverload'],
    type: 'combination',
    formations: F(1, 1, 1.15),
    phases: ['midcourt', 'finalThird'],
    roles: ['drop', 'run', 'cover'],
    primitives: ['refillVacancy', 'layoffSupport'],
    risk: 0.25,
    coordination: 0.45,
    cooldown: 4,
  },
  switchPlay: {
    id: 'switchPlay',
    kinds: ['switchPlay'],
    type: 'combination',
    formations: F(1, 1.05, 1),
    phases: ['buildUp', 'midcourt', 'finalThird'],
    roles: ['run', 'switch'],
    primitives: ['firstTimeLink', 'laneCheck', 'carrierAction'],
    risk: 0.25,
    coordination: 0.3,
    cooldown: 3,
  },
  pisada: {
    id: 'pisada',
    kinds: ['pisada'],
    type: 'carrier',
    formations: F(1, 1, 1),
    phases: ['buildUp', 'midcourt', 'finalThird'],
    roles: ['run'],
    primitives: ['carrierAction'],
    risk: 0.3,
    coordination: 0.3,
    cooldown: 3,
  },
  isolation: {
    id: 'isolation',
    kinds: ['isolation'],
    type: 'combination',
    formations: F(1, 1, 1.05),
    phases: ['midcourt', 'finalThird'],
    roles: ['cover'],
    primitives: ['decoy', 'carrierAction'],
    risk: 0.35,
    coordination: 0.3,
    cooldown: 6,
  },
  betweenLines: {
    id: 'betweenLines',
    kinds: ['betweenLines'],
    type: 'individual',
    formations: F(0.9, 1.15, 1),
    phases: ['midcourt', 'finalThird'],
    roles: [],
    primitives: ['individual', 'laneCheck'],
    risk: 0.1,
    coordination: 0,
    cooldown: 0,
  },
}

/** The family a runtime kind belongs to. */
export const KIND_FAMILY: Readonly<Record<MovementKind, FamilyId>> = (() => {
  const out = {} as Record<MovementKind, FamilyId>
  for (const f of FAMILY_IDS) for (const k of FAMILIES[f].kinds) out[k] = f
  return out
})()

// --------------------------------------------------------------------------- team settings

/** Per-family priority set by the coach (`off` never selects it). */
export type FamilyPriority = 'off' | 'low' | 'normal' | 'high'
export const FAMILY_PRIORITIES: readonly FamilyPriority[] = ['off', 'low', 'normal', 'high']

/**
 * Team rotation settings, 0-100 each (50 = the default balance). Every value changes the AI:
 * - `frequency`: how readily a move beats keeping the shape (and the pause between combinations).
 * - `freedom`: individual movement (V-cuts, between the lines) and moves from other formations.
 * - `discipline`: weight of the formation profile, balance and the recovery after a move.
 * - `penetration`: value of runs towards goal and scoring chances.
 * - `passingRisk`: how much interception risk is accepted (selection and the rotation pass lane).
 * - `balance`: rest defence required behind the ball.
 * - `patience`: rotations of the formation over quick combinations; the build-up stays patient
 *   further up the court.
 * - `familiarity`: how well the team knows its moves (timing delay, coordination penalty).
 */
export interface RotationStyle {
  frequency: number
  freedom: number
  discipline: number
  penetration: number
  passingRisk: number
  balance: number
  patience: number
  familiarity: number
}

export const STYLE_KEYS: readonly (keyof RotationStyle)[] = [
  'frequency',
  'freedom',
  'discipline',
  'penetration',
  'passingRisk',
  'balance',
  'patience',
  'familiarity',
]

export const DEFAULT_STYLE: Readonly<RotationStyle> = {
  frequency: 50,
  freedom: 50,
  discipline: 50,
  penetration: 50,
  passingRisk: 50,
  balance: 50,
  patience: 50,
  familiarity: 70,
}

export type PresetId = 'classic31' | 'fluid40' | 'direct' | 'positional' | 'combination' | 'compact'
export const PRESET_IDS: readonly PresetId[] = [
  'classic31',
  'fluid40',
  'direct',
  'positional',
  'combination',
  'compact',
]

export interface RotationPreset {
  id: PresetId
  formation: Formation
  style: RotationStyle
  priorities: Partial<Record<FamilyId, FamilyPriority>>
}

/** Fictional coaching styles inspired by general tactical traits (not any real team). */
export const PRESETS: Readonly<Record<PresetId, RotationPreset>> = {
  classic31: {
    id: 'classic31',
    formation: '3-1',
    style: { ...DEFAULT_STYLE, frequency: 50, balance: 70, discipline: 65 },
    priorities: {
      threeRotation: 'high',
      thirdMan: 'high',
      pivotLayoff: 'high',
      pivotExchange: 'high',
      baseEight: 'normal',
    },
  },
  fluid40: {
    id: 'fluid40',
    formation: '4-0',
    style: { ...DEFAULT_STYLE, frequency: 75, freedom: 75, discipline: 40 },
    priorities: {
      fourRotation: 'high',
      fourEight: 'high',
      parallelRotation: 'high',
      diagonalRotation: 'high',
      pivotExchange: 'high',
    },
  },
  direct: {
    id: 'direct',
    formation: '3-1',
    style: { ...DEFAULT_STYLE, frequency: 35, penetration: 80, patience: 25, passingRisk: 65 },
    priorities: { paralela: 'high', pivotLayoff: 'high', diagonalRun: 'high', baseEight: 'low' },
  },
  positional: {
    id: 'positional',
    formation: '4-0',
    style: { ...DEFAULT_STYLE, frequency: 70, discipline: 75, patience: 70, freedom: 40 },
    priorities: {
      diagonalRotation: 'high',
      fourRotation: 'high',
      thirdMan: 'high',
      switchPlay: 'high',
      isolation: 'low',
    },
  },
  combination: {
    id: 'combination',
    formation: '2-2',
    style: { ...DEFAULT_STYLE, frequency: 65, freedom: 80, discipline: 35, passingRisk: 60 },
    priorities: { wallPass: 'high', pisada: 'high', thirdMan: 'high', isolation: 'high', crossRun: 'high' },
  },
  compact: {
    id: 'compact',
    formation: '3-1',
    style: { ...DEFAULT_STYLE, frequency: 45, balance: 80, passingRisk: 30, penetration: 40 },
    priorities: { doubleCut: 'off', crossRun: 'low', isolation: 'low' },
  },
}

/** A style value as 0..1 (50 -> 0.5). */
export const s01 = (v: number): number => Math.min(1, Math.max(0, v / 100))

/** The rotation part of a team's tactics as the UI edits and saves it. */
export interface RotationSettings {
  preset: PresetId | null
  style: RotationStyle
  priorities: Partial<Record<FamilyId, FamilyPriority>>
}

export const DEFAULT_ROTATION_SETTINGS: Readonly<RotationSettings> = {
  preset: null,
  style: { ...DEFAULT_STYLE },
  priorities: {},
}

/** The settings of a preset (style and priorities copied). */
export function presetSettings(id: PresetId): RotationSettings {
  const p = PRESETS[id]
  return { preset: id, style: { ...p.style }, priorities: { ...p.priorities } }
}

/** Saved / untrusted settings made valid (unknown keys dropped, values clamped to 0-100). */
export function sanitizeRotationSettings(raw: unknown): RotationSettings {
  const out: RotationSettings = { preset: null, style: { ...DEFAULT_STYLE }, priorities: {} }
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>
  if (typeof r.preset === 'string' && (PRESET_IDS as readonly string[]).includes(r.preset))
    out.preset = r.preset as PresetId
  const st = (r.style ?? {}) as Record<string, unknown>
  for (const key of STYLE_KEYS) {
    const v = st[key]
    if (typeof v === 'number' && Number.isFinite(v))
      out.style[key] = Math.round(Math.min(100, Math.max(0, v)))
  }
  const pr = (r.priorities ?? {}) as Record<string, unknown>
  for (const f of FAMILY_IDS) {
    const v = pr[f]
    if (typeof v === 'string' && (FAMILY_PRIORITIES as readonly string[]).includes(v) && v !== 'normal')
      out.priorities[f] = v as FamilyPriority
  }
  return out
}
