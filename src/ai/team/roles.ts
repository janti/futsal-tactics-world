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
import { dynamicAnchor } from '../positioning/Formation'

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
    cost += dist(state.players[id]!.pos, dynamicAnchor(role, 'attack', dir, state.ball.pos))
  return cost
}

function bestAssignment(state: MatchState, team: TeamId): Map<number, PlayerRole> {
  const dir = state.teams[team].attackDir
  const players = state.players.filter((p) => p.team === team && p.role !== 'GK')
  const anchors = ROLES.map((r) => dynamicAnchor(r, 'attack', dir, state.ball.pos))
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
