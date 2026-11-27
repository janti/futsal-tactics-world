/**
 * Dynamic role assignment in attack. The four outfield roles of the attacking shape (fixo, two alas,
 * pivot) are handed out to whoever is nearest to each role's place, so after a run, a rotation or a
 * dribble the players fill the shape from where they are instead of all running back to their
 * nominal positions. The assignment minimises the total distance (all 24 permutations), is refreshed
 * twice a second and only changes when the new one is clearly better (hysteresis), so roles do not
 * flicker. Out of possession everybody keeps his nominal role (the defensive diamond and marking use
 * their own assignment).
 */
import { dist } from '../../core/math/vec2'
import type { MatchState, PlayerRole, PlayerState, TeamId } from '../../simulation/MatchState'
import { diamondAnchor, dynamicAnchor } from '../positioning/Formation'

const ROLES: PlayerRole[] = ['FIXO', 'ALA_L', 'ALA_R', 'PIVOT']
const REFRESH_TICKS = 30
/** A new assignment must save this many metres in total to replace the current one. */
const SWITCH_MARGIN = 3

interface RoleCache {
  tick: number
  roles: Map<number, PlayerRole>
}

const cache = new WeakMap<MatchState, [RoleCache | null, RoleCache | null]>()

function assignmentCost(state: MatchState, team: TeamId, roles: Map<number, PlayerRole>): number {
  const dir = state.teams[team].attackDir
  let cost = 0
  for (const [id, role] of roles)
    cost += dist(
      state.players[id]!.pos,
      dynamicAnchor(role, 'attack', dir, state.ball.pos, state.teams[team].tactics.formation),
    )
  return cost
}

function bestAssignment(state: MatchState, team: TeamId): Map<number, PlayerRole> {
  const dir = state.teams[team].attackDir
  const players = state.players.filter((p) => p.team === team && p.role !== 'GK')
  const formation = state.teams[team].tactics.formation
  const anchors = ROLES.map((r) => dynamicAnchor(r, 'attack', dir, state.ball.pos, formation))
  let best: number[] = []
  let bestCost = Infinity
  const perm: number[] = []
  const used = new Array<boolean>(ROLES.length).fill(false)
  const rec = (i: number, cost: number) => {
    if (cost >= bestCost) return
    if (i === players.length) {
      bestCost = cost
      best = [...perm]
      return
    }
    for (let r = 0; r < ROLES.length; r++) {
      if (used[r]) continue
      used[r] = true
      perm.push(r)
      rec(i + 1, cost + dist(players[i]!.pos, anchors[r]!))
      perm.pop()
      used[r] = false
    }
  }
  rec(0, 0)
  const out = new Map<number, PlayerRole>()
  best.forEach((r, i) => out.set(players[i]!.id, ROLES[r]!))
  return out
}

/** The attacking role a player currently plays (his nominal role when not attacking). */
export function attackingRole(state: MatchState, p: PlayerState): PlayerRole {
  if (p.role === 'GK' || state.possessionTeam !== p.team) return p.role
  let entry = cache.get(state)
  if (!entry) {
    entry = [null, null]
    cache.set(state, entry)
  }
  const team = p.team
  let c = entry[team]
  if (!c || state.tick - c.tick >= REFRESH_TICKS || state.tick < c.tick) {
    const fresh = bestAssignment(state, team)
    if (
      !c ||
      c.roles.size !== fresh.size ||
      assignmentCost(state, team, fresh) < assignmentCost(state, team, c.roles) - SWITCH_MARGIN
    )
      c = { tick: state.tick, roles: fresh }
    else c = { tick: state.tick, roles: c.roles }
    entry[team] = c
  }
  return c.roles.get(p.id) ?? p.role
}

/**
 * Dynamic roles in defence, the same idea as in attack: the four places of the defensive diamond go to
 * whoever is nearest each of them, so after losing the ball (players out of position after runs and
 * rotations) nobody runs across the court to his nominal place — the pivot caught on a wing does not
 * run to the middle while the ala there runs to the wing; they swap roles. Refreshed twice a second
 * with hysteresis; recomputed at once when the ball is lost.
 */
interface DefCache {
  tick: number
  possession: TeamId | null
  roles: Map<number, PlayerRole>
}

const defCache = new WeakMap<MatchState, [DefCache | null, DefCache | null]>()

const UPPER: PlayerRole[] = ['ALA_L', 'ALA_R', 'PIVOT']
/** Defence: roles are re-dealt at most once a second, and only for a clearly better fit (stable marking). */
const DEF_REFRESH_TICKS = 60
const DEF_SWITCH_MARGIN = 6

function defensiveAssignment(state: MatchState, team: TeamId): Map<number, PlayerRole> {
  const dir = state.teams[team].attackDir
  const t = state.teams[team].tactics
  const all = state.players.filter((p) => p.team === team && p.role !== 'GK')
  // The last man stays the last man: the deepest outfield player is the fixo (he never leaves the
  // goal open by going up to an ala's place while somebody further up runs back).
  let deepest = all[0]!
  for (const p of all) if (p.pos.y * dir < deepest.pos.y * dir) deepest = p
  const players = all.filter((p) => p.id !== deepest.id)
  const anchors = UPPER.map((r) => diamondAnchor(r, dir, state.ball.pos, t))
  let best: number[] = []
  let bestCost = Infinity
  const perm: number[] = []
  const used = new Array<boolean>(UPPER.length).fill(false)
  const rec = (i: number, cost: number) => {
    if (cost >= bestCost) return
    if (i === players.length) {
      bestCost = cost
      best = [...perm]
      return
    }
    for (let r = 0; r < UPPER.length; r++) {
      if (used[r]) continue
      used[r] = true
      perm.push(r)
      rec(i + 1, cost + dist(players[i]!.pos, anchors[r]!))
      perm.pop()
      used[r] = false
    }
  }
  rec(0, 0)
  const out = new Map<number, PlayerRole>()
  out.set(deepest.id, 'FIXO')
  best.forEach((r, i) => out.set(players[i]!.id, UPPER[r]!))
  return out
}

function defensiveCost(state: MatchState, team: TeamId, roles: Map<number, PlayerRole>): number {
  const dir = state.teams[team].attackDir
  const t = state.teams[team].tactics
  let cost = 0
  for (const [id, role] of roles)
    cost += dist(state.players[id]!.pos, diamondAnchor(role, dir, state.ball.pos, t))
  return cost
}

/** The defensive role a player currently plays (his nominal role while his team has the ball). */
export function defensiveRole(state: MatchState, p: PlayerState): PlayerRole {
  if (p.role === 'GK' || state.possessionTeam === p.team) return p.role
  let entry = defCache.get(state)
  if (!entry) {
    entry = [null, null]
    defCache.set(state, entry)
  }
  const team = p.team
  let c = entry[team]
  const lost = !c || c.possession !== state.possessionTeam
  if (lost || state.tick - c!.tick >= DEF_REFRESH_TICKS || state.tick < c!.tick) {
    const fresh = defensiveAssignment(state, team)
    if (
      lost ||
      c!.roles.size !== fresh.size ||
      defensiveCost(state, team, fresh) < defensiveCost(state, team, c!.roles) - DEF_SWITCH_MARGIN
    )
      c = { tick: state.tick, possession: state.possessionTeam, roles: fresh }
    else c = { tick: state.tick, possession: state.possessionTeam, roles: c!.roles }
    entry[team] = c
  }
  return c!.roles.get(p.id) ?? p.role
}
