import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { NAME_POOLS } from '../../src/data/namePools'
import { generatePlayer } from '../../src/data/playerGenerator'
import { applyRosterPlayer, pickStartingFive, roleFromPosition } from '../../src/data/localRosters'
import { SeededRandom } from '../../src/core/random/SeededRandom'

describe('team library', () => {
  it('has clubs and men and women national teams, Finland included, with unique ids', () => {
    const ids = TEAM_LIBRARY.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(TEAM_LIBRARY.filter((t) => t.category === 'men').length).toBeGreaterThanOrEqual(6)
    expect(TEAM_LIBRARY.filter((t) => t.category === 'women').length).toBeGreaterThanOrEqual(5)
    expect(ids).toContain('FIN-M')
    expect(ids).toContain('FIN-W')
    // The first four are the original clubs (saved Quick Match choices keep pointing at them).
    expect(TEAM_LIBRARY.slice(0, 4).every((t) => t.category === 'club')).toBe(true)
    for (const t of TEAM_LIBRARY) if (t.category !== 'club') expect(NAME_POOLS[t.nation]).toBeDefined()
  })

  it('national teams get fictional names from their nation pool; women players are generated as women', () => {
    const rng = new SeededRandom(9)
    const pool = NAME_POOLS.BRA!
    for (let i = 0; i < 20; i++) {
      const p = generatePlayer(rng, i, 'ALA_L', 7, 70, { nation: 'BRA', women: true })
      expect(pool.female).toContain(p.firstName)
      expect(pool.surnames).toContain(p.lastName)
      expect(p.nationality).toBe('BRA')
      expect(p.heightCm).toBeLessThanOrEqual(186)
    }
  })
})

describe('local rosters (format and selection; the files themselves are git-ignored)', () => {
  it('maps source positions to game roles', () => {
    expect(roleFromPosition('GK')).toBe('GK')
    expect(roleFromPosition('DF')).toBe('FIXO')
    expect(roleFromPosition('Winger')).toBe('ALA')
    expect(roleFromPosition('MF')).toBe('ALA')
    expect(roleFromPosition('FW')).toBe('PIVOT')
    expect(roleFromPosition('Pivot')).toBe('PIVOT')
    expect(roleFromPosition('FP')).toBeNull()
  })

  it('picks a starting five by role, filling the rest in list order (a keeper only in goal)', () => {
    const five = pickStartingFive([
      { name: 'Keeper One', position: 'GK' },
      { name: 'Keeper Two', position: 'GK' },
      { name: 'Field A', position: 'FP' },
      { name: 'Pivot P', position: 'FW' },
      { name: 'Field B', position: 'FP' },
      { name: 'Field C', position: 'FP' },
    ])
    expect(five.map((p) => p?.name)).toEqual(['Keeper One', 'Field A', 'Field B', 'Field C', 'Pivot P'])
  })

  it('a real name and number replace the generated ones (single names allowed)', () => {
    const p = generatePlayer(new SeededRandom(1), 0, 'GK', 1, 70)
    applyRosterPlayer(p, { name: 'Somebody Real', number: 12 })
    expect([p.firstName, p.lastName, p.shirtNumber]).toEqual(['Somebody', 'Real', 12])
    applyRosterPlayer(p, { name: 'Mononym' })
    expect([p.firstName, p.lastName]).toEqual(['', 'Mononym'])
  })
})
