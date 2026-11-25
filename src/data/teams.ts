import type { PlayerRole } from '../simulation/MatchState'

/**
 * Provisional fictional club identities (see GAME_DESIGN.md). Names must be checked for accidental
 * conflicts with existing clubs before any public release.
 */
export interface TeamDefinition {
  name: string
  shortName: string
  primaryColor: number
  secondaryColor: number
  numberColor: number
  quality: number
}

export const TEAM_LIBRARY: TeamDefinition[] = [
  {
    name: 'Kuopio Futsal United',
    shortName: 'KFU',
    primaryColor: 0x1f5fbf,
    secondaryColor: 0xf2f5f8,
    numberColor: 0xffffff,
    quality: 64,
  },
  {
    name: 'Helsinki City Futsal',
    shortName: 'HCF',
    primaryColor: 0xd23a2f,
    secondaryColor: 0x1a1a1a,
    numberColor: 0xffffff,
    quality: 64,
  },
  {
    name: 'Tampere Athletic',
    shortName: 'TAM',
    primaryColor: 0xf0c419,
    secondaryColor: 0x101923,
    numberColor: 0x101923,
    quality: 62,
  },
  {
    name: 'Oulu Northern Stars',
    shortName: 'ONS',
    primaryColor: 0x1d8a5a,
    secondaryColor: 0xf2f5f8,
    numberColor: 0xffffff,
    quality: 61,
  },
]

/** Starting five in squad order: GK, Fixo, left Ala, right Ala, Pivot. */
export const STARTING_ROLES: PlayerRole[] = ['GK', 'FIXO', 'ALA_L', 'ALA_R', 'PIVOT']
export const STARTING_NUMBERS = [1, 4, 7, 11, 9]
