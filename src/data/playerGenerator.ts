import { clamp } from '../core/math/scalar'
import { SeededRandom } from '../core/random/SeededRandom'
import type { PlayerAttributes, PlayerProfile, PlayerRole } from '../simulation/MatchState'
import { NAME_POOLS } from './namePools'

/** Fictional name pools. Combinations are procedurally generated and not intended to depict real people. */
const FINNISH_FIRST = [
  'Aleksi',
  'Antti',
  'Eero',
  'Elias',
  'Joona',
  'Juho',
  'Kalle',
  'Lauri',
  'Leo',
  'Miro',
  'Niko',
  'Onni',
  'Otto',
  'Paavo',
  'Rasmus',
  'Sami',
  'Tuomas',
  'Valtteri',
  'Veeti',
  'Ville',
]
const FINNISH_LAST = [
  'Aaltonen',
  'Heikkilä',
  'Hirvonen',
  'Kallio',
  'Karjalainen',
  'Koivisto',
  'Laaksonen',
  'Lehtinen',
  'Mäkelä',
  'Nieminen',
  'Ojala',
  'Peltonen',
  'Rantanen',
  'Saarinen',
  'Salmi',
  'Toivonen',
  'Vainio',
  'Virtanen',
  'Väisänen',
  'Ylönen',
]
const INTL_FIRST = ['Diego', 'Marco', 'Rafael', 'Tiago', 'Iker', 'Luca', 'André', 'Mateus']
const INTL_LAST = ['Almeida', 'Costa', 'Ferreira', 'Moreno', 'Navarro', 'Ribeiro', 'Santos', 'Vidal']

const SKIN_TONES = [0xf1c8a5, 0xe0ac85, 0xc68863, 0x9a6440, 0x6e4529]
const HAIR_COLORS = [0x2b1d14, 0x4a3020, 0x8a6a3a, 0xc9a35c, 0x151515, 0x6b4a2d]

/** Role-specific attribute emphasis (added to a base around 55–70). */
const ROLE_BIAS: Record<PlayerRole, Partial<Record<keyof PlayerAttributes, number>>> = {
  GK: {
    reflexes: 22,
    handling: 20,
    gkPositioning: 20,
    oneOnOne: 18,
    diving: 20,
    throwing: 15,
    distribution: 12,
    footwork: 8,
    finishing: -25,
    dribbling: -20,
  },
  FIXO: {
    tackling: 14,
    interception: 14,
    positioning: 12,
    passing: 8,
    strength: 8,
    vision: 6,
    finishing: -6,
  },
  ALA_L: { dribbling: 10, acceleration: 8, sprintSpeed: 8, agility: 8, passing: 4, creativity: 6 },
  ALA_R: { dribbling: 10, acceleration: 8, sprintSpeed: 8, agility: 8, passing: 4, creativity: 6 },
  PIVOT: { pivotPlay: 18, strength: 12, finishing: 12, soleControl: 8, balance: 8, shotPower: 6 },
}

const ATTR_KEYS: (keyof PlayerAttributes)[] = [
  'passing',
  'firstTouch',
  'ballControl',
  'dribbling',
  'soleControl',
  'finishing',
  'shotPower',
  'shotAccuracy',
  'weakFoot',
  'tackling',
  'interception',
  'pivotPlay',
  'acceleration',
  'sprintSpeed',
  'agility',
  'balance',
  'strength',
  'stamina',
  'reactionSpeed',
  'recovery',
  'decisions',
  'anticipation',
  'vision',
  'composure',
  'positioning',
  'teamwork',
  'workRate',
  'creativity',
  'tacticalIntelligence',
  'concentration',
  'reflexes',
  'handling',
  'gkPositioning',
  'oneOnOne',
  'diving',
  'throwing',
  'distribution',
  'footwork',
]

const GK_ONLY = new Set<keyof PlayerAttributes>([
  'reflexes',
  'handling',
  'gkPositioning',
  'oneOnOne',
  'diving',
  'throwing',
  'distribution',
  'footwork',
])

export function generateAttributes(rng: SeededRandom, role: PlayerRole, quality: number): PlayerAttributes {
  const bias = ROLE_BIAS[role]
  const out = {} as PlayerAttributes
  for (const key of ATTR_KEYS) {
    const base = GK_ONLY.has(key) && role !== 'GK' ? 25 : quality
    const v = base + (bias[key] ?? 0) + rng.gaussian() * 8
    out[key] = Math.round(clamp(v, 1, 99))
  }
  return out
}

export interface GenerateOptions {
  /** National team: all names from that nation's pool (clubs mix in a few internationals). */
  nation?: string
  women?: boolean
}

export function generatePlayer(
  rng: SeededRandom,
  id: number,
  role: PlayerRole,
  shirtNumber: number,
  quality: number,
  opts: GenerateOptions = {},
): PlayerProfile {
  const pool = opts.nation ? NAME_POOLS[opts.nation] : undefined
  const international = !pool && rng.chance(0.15)
  let firstName: string
  let lastName: string
  if (pool) {
    firstName = rng.pick(opts.women ? pool.female : pool.male)
    lastName = rng.pick(pool.surnames)
  } else {
    firstName = rng.pick(international ? INTL_FIRST : FINNISH_FIRST)
    lastName = rng.pick(international ? INTL_LAST : FINNISH_LAST)
  }
  const meanHeight = opts.women ? 167 : 178
  const heightCm = Math.round(
    clamp(
      meanHeight + rng.gaussian() * 6 + (role === 'GK' ? 6 : 0) + (role === 'PIVOT' ? 3 : 0),
      opts.women ? 152 : 164,
      opts.women ? 186 : 198,
    ),
  )
  return {
    id,
    firstName,
    lastName,
    nationality: pool ? opts.nation! : international ? rng.pick(['ESP', 'POR', 'BRA', 'ITA']) : 'FIN',
    age: rng.int(19, 34),
    heightCm,
    weightKg: Math.round(heightCm - 104 + rng.gaussian() * 5),
    preferredFoot: rng.chance(0.25) ? 'left' : 'right',
    shirtNumber,
    position: role,
    attributes: generateAttributes(rng, role, quality),
    skinTone: rng.pick(SKIN_TONES),
    hairColor: rng.pick(HAIR_COLORS),
    // Women's squads: mostly long hair (style 1), sometimes short or tied.
    hairStyle: opts.women ? (rng.chance(0.75) ? 1 : rng.int(0, 2)) : rng.int(0, 3),
  }
}
