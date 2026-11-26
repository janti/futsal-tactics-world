import type { PlayerProfile, PlayerRole } from '../simulation/MatchState'

/**
 * Optional local rosters. Files in `src/data/local/*.json` are git-ignored (the example file is the
 * only one committed): they let a player use real squads for private, local play without them ever
 * entering version control or the published game. Without such a file the game uses its fictional,
 * generated players.
 */
export interface LocalRosterPlayer {
  name: string
  number?: number
  /** As written by the source: GK, DF, MF, FW, FP, Fixo, Ala, Winger, Pivot, Universal... */
  position?: string
}

export interface LocalRosterFile {
  /** Free-text note about where the data came from and how current it is. */
  source?: string
  teams: Record<string, { players: LocalRosterPlayer[] }>
}

type RoleGuess = PlayerRole | 'ALA' | null

/** Map a source position label to a game role (null = outfield, any role). */
export function roleFromPosition(position: string | undefined): RoleGuess {
  const p = (position ?? '').trim().toLowerCase()
  if (p === 'gk' || p.startsWith('goal')) return 'GK'
  if (p === 'df' || p.startsWith('def') || p.startsWith('fixo') || p === 'back') return 'FIXO'
  if (
    p === 'mf' ||
    p.startsWith('ala') ||
    p.startsWith('wing') ||
    p.startsWith('mid') ||
    p.startsWith('univ')
  )
    return 'ALA'
  if (p === 'fw' || p.startsWith('piv') || p.startsWith('for') || p.startsWith('strik')) return 'PIVOT'
  return null
}

/**
 * Pick the starting five (GK, Fixo, left Ala, right Ala, Pivot) from a roster: the first player listed
 * for each role; slots without an exact match take the best remaining fit (wings prefer forwards over
 * defenders, a keeper only in goal).
 */
export function pickStartingFive(players: LocalRosterPlayer[]): (LocalRosterPlayer | null)[] {
  const slots: PlayerRole[] = ['GK', 'FIXO', 'ALA_L', 'ALA_R', 'PIVOT']
  // Preferred source roles per slot, best first (null = unspecified outfield player, e.g. "FP").
  const prefs: Record<PlayerRole, RoleGuess[]> = {
    GK: ['GK'],
    FIXO: ['FIXO', null, 'ALA', 'PIVOT'],
    ALA_L: ['ALA', null, 'PIVOT', 'FIXO'],
    ALA_R: ['ALA', null, 'PIVOT', 'FIXO'],
    PIVOT: ['PIVOT', null, 'ALA', 'FIXO'],
  }
  const used = new Set<LocalRosterPlayer>()
  const out: (LocalRosterPlayer | null)[] = [null, null, null, null, null]
  // First pass: exact role matches in list order; then each slot takes its next best preference.
  for (let level = 0; level < 4; level++) {
    slots.forEach((slot, i) => {
      if (out[i]) return
      const want = prefs[slot][level]
      if (want === undefined) return
      const p = players.find((q) => !used.has(q) && roleFromPosition(q.position) === want)
      if (p) {
        out[i] = p
        used.add(p)
      }
    })
  }
  return out
}

function loadFiles(): LocalRosterFile[] {
  const modules = import.meta.glob<{ default: LocalRosterFile }>('./local/*.json', { eager: true })
  return Object.entries(modules)
    .filter(([path]) => !path.endsWith('.example.json'))
    .map(([, m]) => m.default)
    .filter((f) => f && typeof f === 'object' && f.teams && typeof f.teams === 'object')
}

/**
 * Only the dev server (npm run dev) reads local rosters; a production build leaves them out (and the
 * bundler drops the files) unless VITE_LOCAL_ROSTERS=1 is set for a private build.
 */
const FILES: LocalRosterFile[] =
  import.meta.env.DEV || import.meta.env.VITE_LOCAL_ROSTERS === '1' ? loadFiles() : []

/** The local roster for a team id (e.g. "FIN-M"), if a local file provides one. */
export function localRoster(teamId: string): LocalRosterPlayer[] | null {
  for (const f of FILES) {
    const t = f.teams[teamId]
    if (t && Array.isArray(t.players) && t.players.length > 0) return t.players
  }
  return null
}

/** True when any local roster file is present (shown in the setup screen). */
export function hasLocalRosters(): boolean {
  return FILES.length > 0
}

/** Put a real player's name and number on a generated profile (attributes stay generated). */
export function applyRosterPlayer(profile: PlayerProfile, player: LocalRosterPlayer): void {
  const parts = player.name.trim().split(/\s+/)
  if (parts.length === 1) {
    profile.firstName = ''
    profile.lastName = parts[0]!
  } else {
    profile.firstName = parts.slice(0, -1).join(' ')
    profile.lastName = parts[parts.length - 1]!
  }
  if (typeof player.number === 'number' && player.number > 0 && player.number < 100)
    profile.shirtNumber = player.number
}
