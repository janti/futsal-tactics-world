import type { TeamTactics } from '../simulation/Tactics'
import type { PlayerRole } from '../simulation/MatchState'

export type TeamCategory = 'club' | 'men' | 'women'

/**
 * Team identities. Clubs are provisional fictional names (see GAME_DESIGN.md; check for accidental
 * conflicts with existing clubs before any public release). National teams use the country name and
 * plain colours only — no federation crests or logos — and fictional, generated players; real squads
 * can only come from a local, git-ignored file (src/data/local).
 */
export interface TeamDefinition {
  /** Stable id, also the key for local rosters (e.g. "FIN-M", "ESP-W"). */
  id: string
  category: TeamCategory
  /** Nation code for the name pool (fictional names) and nationality. */
  nation: string
  name: string
  /** Finnish display name, when different. */
  nameFi?: string
  shortName: string
  primaryColor: number
  secondaryColor: number
  numberColor: number
  quality: number
  /** The team's usual tactics (the computer plays them; defaults otherwise). */
  tactics?: Partial<TeamTactics>
}

/** Playing styles of the national teams (generic futsal stereotypes, freely adjustable). */
const NATION_TACTICS: Record<string, Partial<TeamTactics>> = {
  ESP: { formation: '4-0', pressing: 'high' },
  POR: { formation: '3-1', pressing: 'high' },
  BRA: { formation: '4-0', pressing: 'mid' },
  ARG: { formation: '3-1', pressing: 'mid' },
  ITA: { formation: '2-2', pressing: 'mid' },
  IRN: { formation: '3-1', pressing: 'high' },
  KAZ: { formation: '2-2', pressing: 'low' },
}

export const TEAM_LIBRARY: TeamDefinition[] = [
  {
    id: 'KFU',
    category: 'club',
    nation: 'FIN',
    name: 'Kuopio Futsal United',
    shortName: 'KFU',
    primaryColor: 0x1f5fbf,
    secondaryColor: 0xf2f5f8,
    numberColor: 0xffffff,
    quality: 64,
  },
  {
    id: 'HCF',
    category: 'club',
    nation: 'FIN',
    name: 'Helsinki City Futsal',
    shortName: 'HCF',
    primaryColor: 0xd23a2f,
    secondaryColor: 0x1a1a1a,
    numberColor: 0xffffff,
    quality: 64,
  },
  {
    id: 'TAM',
    category: 'club',
    nation: 'FIN',
    name: 'Tampere Athletic',
    shortName: 'TAM',
    primaryColor: 0xf0c419,
    secondaryColor: 0x101923,
    numberColor: 0x101923,
    quality: 62,
    tactics: { formation: '4-0', pressing: 'high' },
  },
  {
    id: 'ONS',
    category: 'club',
    nation: 'FIN',
    name: 'Oulu Northern Stars',
    shortName: 'ONS',
    primaryColor: 0x1d8a5a,
    secondaryColor: 0xf2f5f8,
    numberColor: 0xffffff,
    quality: 61,
    tactics: { formation: '2-2', pressing: 'low' },
  },
  ...nationalTeams(),
]

/** National teams (men's and women's): country names, plain national colours, fictional players. */
function nationalTeams(): TeamDefinition[] {
  const nations: {
    code: string
    name: string
    nameFi: string
    primary: number
    secondary: number
    number: number
    men?: number
    women?: number
  }[] = [
    {
      code: 'FIN',
      name: 'Finland',
      nameFi: 'Suomi',
      primary: 0xf2f5f8,
      secondary: 0x1d3f8f,
      number: 0x1d3f8f,
      men: 66,
      women: 62,
    },
    {
      code: 'ESP',
      name: 'Spain',
      nameFi: 'Espanja',
      primary: 0xc8102e,
      secondary: 0xf1bf00,
      number: 0xf1bf00,
      men: 82,
      women: 80,
    },
    {
      code: 'POR',
      name: 'Portugal',
      nameFi: 'Portugali',
      primary: 0x8b1e2d,
      secondary: 0x046a38,
      number: 0xf2f5f8,
      men: 81,
      women: 78,
    },
    {
      code: 'BRA',
      name: 'Brazil',
      nameFi: 'Brasilia',
      primary: 0xf7d917,
      secondary: 0x1d6f3a,
      number: 0x1d4f9e,
      men: 82,
      women: 80,
    },
    {
      code: 'ARG',
      name: 'Argentina',
      nameFi: 'Argentiina',
      primary: 0x75aadb,
      secondary: 0xf2f5f8,
      number: 0x101923,
      men: 78,
      women: 72,
    },
    {
      code: 'ITA',
      name: 'Italy',
      nameFi: 'Italia',
      primary: 0x0b4fa2,
      secondary: 0xf2f5f8,
      number: 0xf2f5f8,
      women: 72,
    },
    {
      code: 'MAR',
      name: 'Morocco',
      nameFi: 'Marokko',
      primary: 0xc1272d,
      secondary: 0x006233,
      number: 0xf2f5f8,
      men: 77,
    },
    {
      code: 'IRN',
      name: 'Iran',
      nameFi: 'Iran',
      primary: 0xda1f26,
      secondary: 0xf2f5f8,
      number: 0xf2f5f8,
      men: 77,
    },
    {
      code: 'KAZ',
      name: 'Kazakhstan',
      nameFi: 'Kazakstan',
      primary: 0x00afca,
      secondary: 0xfec50c,
      number: 0xfec50c,
      men: 75,
    },
  ]
  const out: TeamDefinition[] = []
  for (const category of ['men', 'women'] as const) {
    for (const n of nations) {
      const quality = n[category]
      if (quality === undefined) continue
      const suffix = category === 'men' ? 'M' : 'W'
      out.push({
        id: `${n.code}-${suffix}`,
        category,
        nation: n.code,
        name: category === 'men' ? n.name : `${n.name} (women)`,
        nameFi: category === 'men' ? n.nameFi : `${n.nameFi} (naiset)`,
        shortName: n.code,
        primaryColor: n.primary,
        secondaryColor: n.secondary,
        numberColor: n.number,
        quality,
        ...(NATION_TACTICS[n.code] ? { tactics: NATION_TACTICS[n.code] } : {}),
      })
    }
  }
  return out
}

/** Display name in the current UI language. */
export function teamDisplayName(t: TeamDefinition, lang: 'fi' | 'en'): string {
  return lang === 'fi' && t.nameFi ? t.nameFi : t.name
}

/** Starting five in squad order: GK, Fixo, left Ala, right Ala, Pivot. */
export const STARTING_ROLES: PlayerRole[] = ['GK', 'FIXO', 'ALA_L', 'ALA_R', 'PIVOT']
export const STARTING_NUMBERS = [1, 4, 7, 11, 9]
