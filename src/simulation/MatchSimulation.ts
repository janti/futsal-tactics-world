/**
 * Authoritative match simulation. Fixed 60 Hz step, seeded randomness, no dependency on Three.js,
 * React, the DOM, the camera or the renderer — it runs headless in tests.
 *
 * Update order per tick:
 *  1. apply queued human commands      6. ball control / steals
 *  2. phase + restart handling         7. ball physics (substepped, with player contacts)
 *  3. AI decisions + steering          8. goal / out-of-play detection
 *  4. action timers                    9. possession + switching
 *  5. player movement + collisions    10. emit events
 */
import { angleDiff, attr, clamp, rateToChance } from '../core/math/scalar'
import { SeededRandom, deriveSeed } from '../core/random/SeededRandom'
import { add, addScaled, angleOf, dist, fromAngle, len, normalize, sub, type Vec2 } from '../core/math/vec2'
import { assistControlledPlayer, outsideClearanceArea, updateAI, type AIActions } from '../ai/BasicAI'
import { baseAnchor } from '../ai/positioning/Formation'
import { DEFAULT_TACTICS, type TeamTactics } from './Tactics'
import { checkOutOfPlay, isGoal, stepBall } from '../physics/BallPhysics'
import { lobVelocity, planPass } from '../physics/PassingPhysics'
import {
  estimateTimeToReach,
  playerRadius,
  resolveGoalCollisions,
  resolvePlayerCollisions,
  routeAroundGoals,
  updatePlayerMovement,
} from '../physics/PlayerPhysics'
import { planShot } from '../physics/ShootingPhysics'
import { generatePlayer } from '../data/playerGenerator'
import { applyRosterPlayer, localRoster, pickStartingFive } from '../data/localRosters'
import { STARTING_NUMBERS, STARTING_ROLES, type TeamDefinition } from '../data/teams'
import type { Command } from './Commands'
import { DIFFICULTY, type Difficulty } from './Difficulty'
import type { MatchEvent } from './Events'
import type { BallState, MatchState, PlayerState, RestartType, TeamId } from './MatchState'
import {
  BALL,
  CONTROL,
  COURT,
  DT,
  HANDS,
  PASS,
  CHIP,
  PLAYER,
  POST_X,
  SIDE_SHOT,
  KEEPER_NARROW,
  RESTART,
  SCREEN,
  SWITCHING,
  THROW,
} from './SimulationConfig'
import { DEFAULT_CONTROL_OPTIONS, type ControlOptions } from './ControlOptions'
import { DEFAULT_RULES, emptyStats, type MatchRules } from './MatchRules'
import { clampRestartAim, restartInward, restartTakerSpot } from './RestartGeometry'

export interface MatchSetup {
  seed: number
  home: TeamDefinition
  away: TeamDefinition
  /** Team controlled by the local human player, or null for AI vs AI. */
  humanTeam: TeamId | null
  /** Player-adjustable control options (defaults: DEFAULT_CONTROL_OPTIONS). */
  control?: Partial<ControlOptions>
  /** Match format (defaults: DEFAULT_RULES). */
  rules?: Partial<MatchRules>
  /** Strength of the computer opponent (default normal). */
  difficulty?: Difficulty
  /** Tactics per team [home, away] (defaults: the team's own style, else DEFAULT_TACTICS). */
  tactics?: [Partial<TeamTactics>?, Partial<TeamTactics>?]
}

export class MatchSimulation implements AIActions {
  readonly state: MatchState
  private readonly rng: SeededRandom
  private events: MatchEvent[] = []

  constructor(setup: MatchSetup) {
    this.rng = new SeededRandom(deriveSeed(setup.seed, 'match'))
    this.state = createInitialState(setup)
    this.setupKickoff(this.state.firstKickoffTeam)
  }

  /**
   * Kick-off at the start of a half: players are placed in kick-off formation. This happens only at
   * the match start and during the half-time break, never during play.
   */
  private setupKickoff(team: TeamId): void {
    this.beginRestart('kickoff', team, { x: 0, y: 0 })
    for (const p of this.state.players) {
      p.pos = baseAnchor(
        p.role,
        p.team === team ? 'kickoffOwn' : 'kickoffOpp',
        this.state.teams[p.team].attackDir,
      )
      p.vel = { x: 0, y: 0 }
      p.facing = this.state.teams[p.team].attackDir === 1 ? Math.PI / 2 : -Math.PI / 2
      p.aiTarget = { ...p.pos }
      p.action = 'none'
    }
    const taker = this.state.players[this.state.restart!.takerId]!
    taker.pos = { x: 0, y: -this.state.teams[team].attackDir * 0.35 }
  }

  /** Events emitted since the last drain. */
  drainEvents(): MatchEvent[] {
    const e = this.events
    this.events = []
    return e
  }

  player(id: number): PlayerState {
    return this.state.players[id]!
  }

  step(commands: readonly Command[] = []): void {
    const s = this.state
    s.tick++
    s.time += DT
    if (s.phase === 'play') {
      s.playingTime += DT
      if (s.possessionTeam !== null) s.stats[s.possessionTeam].possessionTicks++
    }
    if (s.phase === 'fulltime') {
      // Match over: players come to a stop, nothing else happens.
      for (const p of s.players) {
        p.moveIntent = { x: 0, y: 0 }
        updatePlayerMovement(p, false, DT)
      }
      return
    }
    if (this.updateClock()) return
    s.switchCooldown = Math.max(0, s.switchCooldown - DT)
    s.autoSwitchHold = Math.max(0, s.autoSwitchHold - DT)

    this.applyCommands(commands)
    this.updatePhase()
    this.updateNearestDefenderSwitch()
    updateAI(s, this, this.rng, DT)
    if (s.controlledId !== null) assistControlledPlayer(s, this.player(s.controlledId))
    this.lockSetPieceTaker()
    this.updateActions()

    const kickoff = s.phase === 'restart' && s.restart?.type === 'kickoff'
    const prev = kickoff ? s.players.map((p) => ({ x: p.pos.x, y: p.pos.y })) : null
    const holder = s.ball.inHands && s.ball.ownerId !== null ? this.player(s.ball.ownerId) : null
    const holderPrev = holder ? { ...holder.pos } : null
    for (const p of s.players) updatePlayerMovement(p, s.ball.ownerId === p.id, DT, p.id === s.controlledId)
    resolvePlayerCollisions(s.players)
    resolveGoalCollisions(s.players)
    if (prev) this.enforceKickoffPositions(prev)
    this.enforceRestartDistance()
    // The ball may be carried in the hands only inside the own penalty area.
    if (holder && holderPrev && !this.inOwnPenaltyArea(holder, holder.pos)) {
      holder.pos = holderPrev
      holder.vel = { x: 0, y: 0 }
    }

    this.updateBallControl()
    this.updateBall()
    this.updateClearance()
    s.rngState = this.rng.state
  }

  // ---------------------------------------------------------------- commands

  private applyCommands(commands: readonly Command[]): void {
    const s = this.state
    for (const c of commands) {
      if (c.type === 'SetControlOptions') s.control = { ...s.control, ...c.options }
      if (c.type === 'SetTactics') s.teams[c.team].tactics = { ...s.teams[c.team].tactics, ...c.tactics }
    }
    if (s.controlledId === null) return
    const p = this.player(s.controlledId)
    // Human intent is rebuilt from this tick's commands only (no stale movement).
    p.moveIntent = { x: 0, y: 0 }
    p.sprint = false
    p.sole = false
    p.faceTarget = null
    for (const c of commands) {
      switch (c.type) {
        case 'Move':
          if (c.aimOnly) {
            // Aiming: stand still and turn towards the stick direction.
            if (len(c.dir) > 0.1) p.faceTarget = addScaled(p.pos, c.dir, 3)
            break
          }
          p.moveIntent = { x: c.dir.x, y: c.dir.y }
          p.sprint = c.sprint
          p.sole = c.sole
          p.faceTarget = c.sole && s.ball.ownerId !== p.id ? s.ball.pos : null
          // Shielding: holding the ball with the sole and no direction, turn the back to the nearest
          // opponent so the body is between him and the ball.
          if (c.sole && s.ball.ownerId === p.id && len(c.dir) < 0.15) p.faceTarget = this.shieldFacing(p)
          break
        case 'Throw':
          if (s.ball.ownerId === p.id && s.ball.inHands) this.throwBall(p, c.dir, c.power)
          else if (s.ball.ownerId === p.id) this.pass(p, c.dir, false, null)
          break
        case 'Pass':
          if (s.ball.ownerId === p.id) {
            if (c.chip) this.chip(p, c.dir, c.power ?? 0)
            else this.pass(p, c.dir, c.through, null, c.power)
          } else if (this.shouldBuffer(p))
            p.buffered = {
              kind: 'pass',
              through: c.through,
              dir: c.dir,
              ttl: CONTROL.inputBufferTime,
              ...(c.power !== undefined ? { power: c.power } : {}),
              ...(c.chip ? { chip: true } : {}),
            }
          else this.tackle(p)
          break
        case 'Shoot':
          if (s.ball.ownerId === p.id) this.shoot(p, c.dir, c.power)
          else if (this.shouldBuffer(p))
            p.buffered = { kind: 'shot', power: c.power, dir: c.dir, ttl: CONTROL.inputBufferTime }
          break
        case 'Tackle':
          if (s.ball.ownerId !== p.id) this.tackle(p)
          break
        case 'SwitchPlayer':
          this.manualSwitch(c.dir)
          break
        case 'SetControlOptions':
        case 'SetTactics':
          break
      }
    }
  }

  /** Buffer an action (one-touch play) when the ball is arriving or loose nearby. */
  private shouldBuffer(p: PlayerState): boolean {
    const b = this.state.ball
    if (this.state.phase !== 'play') return false
    if (b.mode !== 'free') return false
    return b.intendedReceiverId === p.id || dist(b.pos, p.pos) < 2.2
  }

  // ---------------------------------------------------------------- actions (also used by AI)

  pass(
    p: PlayerState,
    dir: Vec2,
    through: boolean,
    receiver: PlayerState | null,
    power?: number,
    arrival?: number,
  ): void {
    const s = this.state
    if (s.ball.ownerId !== p.id) return
    // Passing assistance applies to the human player only; the AI always passes assisted.
    const human = p.id === s.controlledId && p.team === s.humanTeam
    const assist = human ? s.control.passAssist : 'assisted'
    const firm = arrival ?? (human && !through && power === undefined ? PASS.humanArrivalSpeed : undefined)
    const plan = planPass(s, p, dir, through, this.rng, receiver, assist, power, firm)
    this.kick(p, plan.velocity, 0, 0, 'pass')
    s.ball.intendedReceiverId = plan.receiverId
    s.ball.isShot = false
    this.emit({ type: 'PassStarted', tick: s.tick, playerId: p.id, receiverId: plan.receiverId, through })
    // Assisted switching: control follows the pass on the human team (keepers stay AI-controlled).
    if (plan.receiverId !== null && p.team === s.humanTeam && p.id === s.controlledId) {
      const r = this.player(plan.receiverId)
      if (r.role !== 'GK') this.setControlled(r.id)
    } else if (s.humanTeam !== null && p.team !== s.humanTeam && s.control.defensiveSwitch === 'assisted') {
      this.assistDefensiveSwitch(plan.target)
    }
  }

  /** Keeper's arced throw from the hands to a teammate, landing short of him (AI distribution). */
  lobThrow(p: PlayerState, receiver: PlayerState, apex: number): void {
    const s = this.state
    if (s.ball.ownerId !== p.id || !s.ball.inHands) return
    const target = addScaled(receiver.pos, receiver.vel, 0.5)
    const v = lobVelocity(s.ball.pos, target, apex, 0.85, THROW.releaseHeight)
    const err = this.rng.gaussian() * attr(p.profile.attributes.throwing, THROW.error[0], THROW.error[1])
    const h = fromAngle(Math.atan2(v.y, v.x) + err, Math.hypot(v.x, v.y))
    this.kick(p, h, v.vz, 0, 'pass')
    s.ball.intendedReceiverId = receiver.id
    s.ball.landing = addScaled(s.ball.pos, normalize(h), dist(s.ball.pos, target) * 0.85)
    s.ball.isShot = false
    this.emit({ type: 'KeeperThrow', tick: s.tick, playerId: p.id, power: 1, receiverId: receiver.id })
    this.emit({ type: 'PassStarted', tick: s.tick, playerId: p.id, receiverId: receiver.id, through: false })
  }

  /**
   * Chip: a lofted ball over the opponents. `power` (how long the chip key was held) sets the height
   * and the length — a tap just over a leg a few metres away, a full press up to about halfway from
   * the own end. With assistance a teammate in that direction at about that range is the target (it
   * lands short of him so he takes it in his stride); otherwise it goes along the input.
   */
  chip(p: PlayerState, dir: Vec2, power: number): void {
    const s = this.state
    if (s.ball.ownerId !== p.id) return
    const pw = clamp(power, 0, 1)
    const human = p.id === s.controlledId && p.team === s.humanTeam
    const assist = human ? s.control.passAssist : 'assisted'
    const aim = len(dir) > 0.2 ? normalize(dir) : fromAngle(p.facing)
    let length = CHIP.minDistance + (CHIP.maxDistance - CHIP.minDistance) * pw
    let receiver: PlayerState | null = null
    if (assist !== 'manual') {
      const cone = assist === 'semi' ? PASS.semiAssistConeCos : PASS.assistConeCos
      let best = Infinity
      for (const t of s.players) {
        if (t.team !== p.team || t.id === p.id || t.role === 'GK') continue
        const to = sub(t.pos, s.ball.pos)
        const d = len(to)
        if (d < 2.5 || d > CHIP.maxDistance + 4) continue
        const cos = (to.x * aim.x + to.y * aim.y) / d
        if (cos < cone) continue
        // The teammate whose range best matches the press (and the input direction).
        const score = Math.abs(d - length) / 4 + (1 - cos) * 3
        if (score < best) {
          best = score
          receiver = t
        }
      }
    }
    let target = addScaled(s.ball.pos, aim, length)
    if (receiver) {
      target = addScaled(receiver.pos, receiver.vel, 0.4)
      length = dist(s.ball.pos, target)
    }
    const apex = CHIP.minApex + (CHIP.maxApex - CHIP.minApex) * Math.pow(pw, 0.9)
    const vel = lobVelocity(s.ball.pos, target, apex, 0.85)
    const err = this.rng.gaussian() * attr(p.profile.attributes.passing, CHIP.error[0], CHIP.error[1])
    const h = fromAngle(Math.atan2(vel.y, vel.x) + err, Math.hypot(vel.x, vel.y))
    this.kick(p, h, vel.vz, 0, 'pass')
    s.ball.intendedReceiverId = receiver ? receiver.id : null
    s.ball.landing = addScaled(s.ball.pos, normalize(h), length * 0.85)
    s.ball.isShot = false
    this.emit({
      type: 'PassStarted',
      tick: s.tick,
      playerId: p.id,
      receiverId: receiver?.id ?? null,
      through: true,
    })
    if (receiver && human && receiver.role !== 'GK') this.setControlled(receiver.id)
  }

  /**
   * Assisted switching while defending: when the opponent passes, hand control to the defender who
   * can reach the pass target clearly sooner than the current player (with cooldown, never the keeper).
   */
  private assistDefensiveSwitch(target: Vec2): void {
    const s = this.state
    if (s.controlledId === null || s.switchCooldown > 0) return
    const current = this.player(s.controlledId)
    const currentT = estimateTimeToReach(current, target)
    let best: PlayerState | null = null
    let bestT = currentT - 0.45
    for (const p of s.players) {
      if (p.team !== s.humanTeam || p.role === 'GK' || p.id === current.id) continue
      const t = estimateTimeToReach(p, target)
      if (t < bestT) {
        bestT = t
        best = p
      }
    }
    if (best) {
      this.setControlled(best.id)
      s.switchCooldown = PLAYER.switchCooldown
    }
  }

  shoot(p: PlayerState, dir: Vec2, power: number): void {
    const s = this.state
    if (s.ball.ownerId !== p.id) return
    const plan = planShot(s, p, dir, power, this.rng)
    // Long range / tight angle and screening are judged at the moment of the shot.
    const keeper = s.players.find((q) => q.team !== p.team && q.role === 'GK')
    s.ball.shotLongRange = isLongRangeShot(p.pos, s.teams[p.team].attackDir)
    s.ball.shotScreen = keeper ? screenFactor(s, p, keeper) : 0
    if (keeper) {
      keeper.shotStartX = keeper.pos.x
      keeper.shotStartOut = Math.abs(keeper.pos.y + s.teams[keeper.team].attackDir * COURT.halfLength)
    }
    this.kick(p, plan.velocity, plan.vz, plan.spin, 'shot')
    s.ball.isShot = true
    s.ball.shotPlaced = plan.placed
    s.ball.intendedReceiverId = null
    this.emit({ type: 'ShotTaken', tick: s.tick, playerId: p.id, team: p.team, speed: plan.speed })
  }

  /**
   * Goalkeeper throw from the hands with player-chosen direction and power. Low power bowls the ball
   * along the floor; high power is an overarm throw through the air. The teammate nearest the line of
   * the throw is marked as the receiver (runs to meet it; control switches to them).
   */
  throwBall(p: PlayerState, dir: Vec2, power: number): void {
    const s = this.state
    if (s.ball.ownerId !== p.id || !s.ball.inHands) return
    const a = p.profile.attributes
    const pw = clamp(power, 0, 1)
    const aim = len(dir) > 0.2 ? normalize(dir) : fromAngle(p.facing)
    const err = this.rng.gaussian() * attr(a.throwing, THROW.error[0], THROW.error[1]) * (0.6 + pw * 0.6)
    const angle = Math.atan2(aim.y, aim.x) + err
    const speed =
      THROW.minSpeed + (attr(a.throwing, THROW.maxSpeed[0], THROW.maxSpeed[1]) - THROW.minSpeed) * pw
    // Short press: bowled along the floor. Longer press: overarm, with a clearly higher arc than a
    // shot (it is thrown, not kicked).
    const overarm = pw > THROW.overarmPower
    const arc = overarm ? Math.pow((pw - THROW.overarmPower) / (1 - THROW.overarmPower), THROW.arcCurve) : 0
    const vz = overarm ? THROW.minVz + (THROW.maxVz - THROW.minVz) * arc : 0
    const vel = fromAngle(angle, speed)
    const receiver = this.receiverOnLine(p, vel)
    this.kick(p, vel, vz, 0, 'pass')
    s.ball.intendedReceiverId = receiver ? receiver.id : null
    s.ball.isShot = false
    this.emit({
      type: 'KeeperThrow',
      tick: s.tick,
      playerId: p.id,
      power: pw,
      receiverId: receiver?.id ?? null,
    })
    this.emit({
      type: 'PassStarted',
      tick: s.tick,
      playerId: p.id,
      receiverId: receiver?.id ?? null,
      through: false,
    })
    if (p.team === s.humanTeam) {
      // Control moves to the intended receiver, or to the outfield player nearest the throw line.
      const next =
        receiver ??
        s.players
          .filter((q) => q.team === p.team && q.role !== 'GK')
          .reduce((best, q) =>
            dist(q.pos, addScaled(p.pos, vel, 0.6)) < dist(best.pos, addScaled(p.pos, vel, 0.6)) ? q : best,
          )
      this.setControlled(next.id)
    }
  }

  /** Teammate closest to the line of a throw (ahead of the thrower, within 3 m of the line). */
  private receiverOnLine(p: PlayerState, vel: Vec2): PlayerState | null {
    const dirN = normalize(vel)
    let best: PlayerState | null = null
    let bestD = 3
    for (const t of this.state.players) {
      if (t.team !== p.team || t.id === p.id) continue
      const to = sub(t.pos, p.pos)
      const along = to.x * dirN.x + to.y * dirN.y
      if (along < 1.5 || along > 32) continue
      const perp = Math.abs(to.x * dirN.y - to.y * dirN.x)
      if (perp < bestD) {
        bestD = perp
        best = t
      }
    }
    return best
  }

  tackle(p: PlayerState): void {
    if (p.tackleCooldown > 0 || this.state.phase !== 'play') return
    p.action = 'tackle'
    p.actionTime = 0
    p.tackleCooldown = PLAYER.tackleCooldown
  }

  private kick(p: PlayerState, vel: Vec2, vz: number, spin: number, action: 'pass' | 'shot'): void {
    const b = this.state.ball
    const cl = this.state.clearance
    if (cl && p.team === cl.team && p.role === 'GK') cl.released = true
    const fromHands = b.inHands
    if (b.inHands) {
      // Released from the hands: bowled along the floor, or thrown overarm from shoulder height.
      b.inHands = false
      b.z = vz > 0 ? THROW.releaseHeight : 0
      b.vz = Math.max(0, vz)
    }
    b.ownerId = null
    b.mode = 'free'
    b.vel = { x: vel.x, y: vel.y }
    b.vz = vz
    b.spin = spin
    this.updateKeeperRetouch(p)
    if (p.role === 'GK' && this.inOwnHalf(p)) b.keeperRetouchId = p.id
    b.lastTouchId = p.id
    b.lastTouchTeam = p.team
    b.kickPos = { ...b.pos }
    b.kickTime = this.state.time
    b.shotPlaced = false
    b.lastKickerId = p.id
    b.landing = null
    p.touchCooldown = PLAYER.kickCooldown
    p.action = fromHands ? 'throw' : action
    p.actionTime = 0
    p.buffered = null
    p.facing = Math.atan2(vel.y, vel.x)
    this.emit({ type: 'BallKicked', tick: this.state.tick, playerId: p.id, speed: len(vel) })
    const s = this.state
    if (s.phase === 'restart' && s.restart?.ready) {
      // Play restarts only with the kick. The taker may not touch the ball again until someone else has.
      s.indirectKickBy = s.restart.type === 'freeKick' ? p.id : null
      s.phase = 'play'
      s.restart = null
      b.blockedTouchId = p.id
      this.emit({ type: 'PlayResumed', tick: s.tick })
    }
  }

  /**
   * Kick-ins, corners and kick-offs cannot be dribbled: once the taker is at the ball they stay put
   * (they may turn to aim) until they pass or shoot.
   */
  private lockSetPieceTaker(): void {
    const r = this.state.restart
    if (this.state.phase !== 'restart' || !r?.ready) return
    const taker = this.player(r.takerId)
    // The human aims with the direction keys (the AI sets r.aimDir itself). The aim is kept legal:
    // kick-ins and corners must go into the court.
    if (taker.id === this.state.controlledId && len(taker.moveIntent) > 0.15) {
      r.aimDir = clampRestartAim(this.state, r, taker.moveIntent)
    }
    // The taker walks around the ball to stand behind it along the aim; the ball stays on the line.
    const target = restartTakerSpot(this.state, r)
    const to = sub(routeAroundGoals(taker.pos, target), taker.pos)
    const d = len(to)
    // A calm step round the ball (walking pace), not a dribble.
    taker.moveIntent =
      d > 0.04 ? addScaled({ x: 0, y: 0 }, normalize(to), Math.min(0.42, d / 0.35)) : { x: 0, y: 0 }
    taker.faceTarget = addScaled(r.spot, r.aimDir, 3)
    taker.sprint = false
    taker.sole = false
  }

  private updateActions(): void {
    const s = this.state
    for (const p of s.players) {
      p.touchCooldown = Math.max(0, p.touchCooldown - DT)
      p.tackleCooldown = Math.max(0, p.tackleCooldown - DT)
      if (p.action !== 'none') {
        p.actionTime += DT
        const duration =
          p.action === 'tackle'
            ? PLAYER.tackleDuration
            : p.action === 'save'
              ? p.saveDive
                ? 0.9
                : 0.6
              : 0.35
        if (p.actionTime > duration) p.action = 'none'
      }
      if (p.action === 'tackle') {
        // Lunge towards the ball.
        const to = normalize(sub(s.ball.pos, p.pos))
        p.moveIntent = to
        p.sprint = true
      }
      if (p.buffered) {
        p.buffered.ttl -= DT
        if (p.buffered.ttl <= 0) p.buffered = null
      }
    }
  }

  // ---------------------------------------------------------------- ball control

  private updateBallControl(): void {
    const s = this.state
    const b = s.ball
    if (b.ownerId === null || b.mode !== 'controlled') return
    if (s.phase === 'restart' && s.restart?.ready) {
      // Ball rests on the spot until it is kicked; opponents must keep their distance (no challenges).
      b.pos = { ...s.restart.spot }
      b.vel = { x: 0, y: 0 }
      b.z = 0
      b.vz = 0
      return
    }
    const owner = this.player(b.ownerId)

    // Four-second rule: the keeper may control the ball (hands or feet) in the own half for 4 s.
    if (owner.role === 'GK' && this.inOwnHalf(owner) && s.phase === 'play') {
      b.handsTimer += DT
      if (b.handsTimer >= HANDS.holdLimit) {
        // Four seconds exceeded: indirect free kick to the opponents where the ball is (on the
        // penalty-area line if the offence was inside the area).
        this.emit({ type: 'KeeperHoldTimeout', tick: s.tick, playerId: owner.id })
        const other: TeamId = owner.team === 0 ? 1 : 0
        this.beginRestart('freeKick', other, this.freeKickSpot(owner.team, b.pos))
        return
      }
    }
    if (b.inHands) {
      // Held in the hands: no challenges possible; the ball moves with the keeper.
      const front = addScaled(owner.pos, fromAngle(owner.facing), HANDS.forward)
      b.pos = front
      b.vel = { x: owner.vel.x, y: owner.vel.y }
      b.z = HANDS.height
      b.vz = 0
      return
    }

    // Opponent challenges: tackles and close-contact steals.
    for (const o of s.players) {
      if (o.team === owner.team || o.touchCooldown > 0) continue
      const d = dist(o.pos, b.pos)
      const tackling = o.action === 'tackle'
      const reach = tackling ? 0.8 : CONTROL.pickupRadius
      if (d > reach) continue
      const ta = o.profile.attributes
      const oa = owner.profile.attributes
      const ratio = (ta.tackling + 20) / (oa.ballControl * 0.6 + oa.strength * 0.2 + oa.balance * 0.2 + 20)
      let success: boolean
      if (tackling) {
        success = this.rng.chance(
          clamp(CONTROL.tackleStealChance * ratio * (owner.sole ? 0.75 : 1), 0.15, 0.92),
        )
        o.action = 'none'
        o.touchCooldown = success ? 0 : 0.35
        this.emit({ type: 'Tackle', tick: s.tick, playerId: o.id, success })
      } else {
        let rate = CONTROL.stealRate * ratio * (owner.sole ? 0.4 : 1)
        const toBall = sub(b.pos, owner.pos)
        const toOpp = sub(o.pos, owner.pos)
        const ballDist = len(toBall)
        if (ballDist > CONTROL.touchReach + 0.2)
          rate *= CONTROL.looseBallStealFactor // knocked ahead
        else if (toBall.x * toOpp.x + toBall.y * toOpp.y < 0)
          // Shielded: the dribbler's body is between the opponent and the ball.
          rate *= attr(oa.strength, CONTROL.shieldFactor[0], CONTROL.shieldFactor[1])
        success = this.rng.chance(rateToChance(rate, DT))
      }
      if (success) {
        owner.touchCooldown = 0.45
        if (this.rng.chance(0.4)) {
          // Poked loose rather than cleanly won.
          const away = normalize(sub(b.pos, owner.pos))
          b.ownerId = null
          b.mode = 'free'
          b.vel = add(
            fromAngle(Math.atan2(away.y, away.x) + this.rng.range(-0.8, 0.8), this.rng.range(2.5, 5)),
            { x: o.vel.x * 0.3, y: o.vel.y * 0.3 },
          )
          b.lastTouchId = o.id
          b.lastTouchTeam = o.team
          b.intendedReceiverId = null
          o.touchCooldown = 0.15
        } else {
          this.giveBall(o)
        }
        this.emit({ type: 'BallIntercepted', tick: s.tick, playerId: o.id, team: o.team })
        return
      }
    }

    const a = owner.profile.attributes
    const speed = len(owner.vel)
    owner.dribbleTouchTimer = Math.max(0, owner.dribbleTouchTimer - DT)
    if (!owner.sole && owner.sprint && speed > CONTROL.touchDribbleSpeed) {
      // Sprint dribble, touch-based: the ball is knocked ahead, rolls a little slower than the
      // runner and is touched again when he has caught it up. Worse dribblers knock it further and
      // less straight; a ball away from the feet is easier to win (see the steal rate above).
      const fwd = fromAngle(owner.facing)
      const rel = sub(b.pos, owner.pos)
      const ahead = rel.x * fwd.x + rel.y * fwd.y
      // The human player changing direction takes the ball with him at once (a touch into the new
      // direction while it is still at his feet) instead of running away from it.
      const human = owner.id === s.controlledId
      const ballOff = len(b.vel) > 0.5 ? Math.abs(angleDiff(angleOf(b.vel), owner.facing)) : 0
      const redirect = human && ballOff > 0.45 && dist(b.pos, owner.pos) < CONTROL.touchReach * 1.4
      if ((owner.dribbleTouchTimer <= 0 && ahead < CONTROL.touchReach) || redirect) {
        // The knock ahead: a little faster than he runs. A touch to change direction (human) is a
        // short one that keeps the ball at his feet — it only turns the ball, it does not push it on.
        const extra = redirect ? 0 : attr(a.dribbling, 1.7, 1.1) * (human ? 0.6 : 1)
        const along = redirect ? speed * 0.85 : speed
        // A human player curving into a new direction turns his body faster than his run bends: the
        // ball goes between where he faces and where he is running, so it stays in front of him.
        let aim = owner.facing
        if (human && speed > 2) aim = owner.facing + angleDiff(owner.facing, angleOf(owner.vel)) * 0.5
        const dir = fromAngle(aim + this.rng.gaussian() * attr(a.ballControl, 0.1, 0.03))
        b.vel = { x: dir.x * (along + extra), y: dir.y * (along + extra) }
        owner.dribbleTouchTimer = CONTROL.touchInterval
      } else {
        // Between touches: the ball rolls on (slower than the runner) and drifts into his line.
        const along = b.vel.x * fwd.x + b.vel.y * fwd.y
        const lat = { x: b.vel.x - fwd.x * along, y: b.vel.y - fwd.y * along }
        const ownerAlong = owner.vel.x * fwd.x + owner.vel.y * fwd.y
        const ownerLat = { x: owner.vel.x - fwd.x * ownerAlong, y: owner.vel.y - fwd.y * ownerAlong }
        const fa = 1 - Math.exp(-3 * DT)
        const fl = 1 - Math.exp(-6 * DT)
        const newAlong = along + (ownerAlong * CONTROL.touchRollRatio - along) * fa
        // Sideways offset of the ball from his line (left positive): steer it back in.
        const latOff = rel.x * -fwd.y + rel.y * fwd.x
        const pull = -latOff * 8 * DT
        const newLat = {
          x: lat.x + (ownerLat.x - lat.x) * fl - fwd.y * pull,
          y: lat.y + (ownerLat.y - lat.y) * fl + fwd.x * pull,
        }
        b.vel = { x: fwd.x * newAlong + newLat.x, y: fwd.y * newAlong + newLat.y }
      }
      b.z = 0
      b.vz = 0
      if (dist(b.pos, owner.pos) > CONTROL.touchLoseDistance || ahead < -0.4) {
        b.ownerId = null
        b.mode = 'free'
      }
      return
    }

    // Dribble: a limited spring relationship towards a point in front of the owner (never attached).
    const offset = owner.sole
      ? CONTROL.soleOffset
      : CONTROL.dribbleOffset + speed * CONTROL.dribbleOffsetPerSpeed
    const target = addScaled(owner.pos, fromAngle(owner.facing), offset)
    const k = owner.sole ? 16 : 11
    const desired = { x: owner.vel.x + (target.x - b.pos.x) * k, y: owner.vel.y + (target.y - b.pos.y) * k }
    const rate = (owner.sole ? attr(a.soleControl, 22, 34) : attr(a.ballControl, 12, 24)) * DT
    const f = 1 - Math.exp(-rate)
    b.vel = { x: b.vel.x + (desired.x - b.vel.x) * f, y: b.vel.y + (desired.y - b.vel.y) * f }
    b.z = 0
    b.vz = 0
    if (dist(b.pos, owner.pos) > CONTROL.loseDistance) {
      b.ownerId = null
      b.mode = 'free'
    }
  }

  /** Facing that turns the back to the nearest opponent within 3 m (shielding), else no change. */
  private shieldFacing(p: PlayerState): Vec2 | null {
    let near: PlayerState | null = null
    let nd = 3
    for (const o of this.state.players) {
      if (o.team === p.team) continue
      const d = dist(o.pos, p.pos)
      if (d < nd) {
        nd = d
        near = o
      }
    }
    return near ? addScaled(p.pos, normalize(sub(p.pos, near.pos)), 3) : null
  }

  private giveBall(p: PlayerState): void {
    const s = this.state
    const b = s.ball
    const prevTeam = s.possessionTeam
    const passer = b.lastTouchId
    const wasPass = b.intendedReceiverId !== null && b.lastTouchTeam === p.team && passer !== p.id
    // A keeper may use the hands only in their own penalty area and not from a teammate's pass.
    // Hands are allowed in the own area unless a teammate deliberately kicked the ball to him (back
    // pass, kick-in...). Saves, his own parries, rebounds and deflections may all be picked up.
    const teammateKick =
      b.lastKickerId !== null && b.lastKickerId !== p.id && this.player(b.lastKickerId).team === p.team
    b.inHands =
      p.role === 'GK' && !teammateKick && b.lastTouchTeam !== null && this.inOwnPenaltyArea(p, b.pos)
    b.lastKickerId = null
    b.handsTimer = 0
    if (b.inHands) {
      // Gathered into the hands at once (no frame with the ball on the floor).
      b.pos = addScaled(p.pos, fromAngle(p.facing), HANDS.forward)
      b.vel = { x: p.vel.x, y: p.vel.y }
      b.z = HANDS.height
      b.vz = 0
    }
    this.updateKeeperRetouch(p)
    b.ownerId = p.id
    b.mode = 'controlled'
    if (b.blockedTouchId !== p.id) b.blockedTouchId = null
    b.lastTouchId = p.id
    b.lastTouchTeam = p.team
    b.intendedReceiverId = null
    b.isShot = false
    b.spin = 0
    p.aiHoldTimer = 0
    p.aiChallengeTimer = 0
    p.action = 'receive'
    p.actionTime = 0
    if (wasPass && passer !== null)
      this.emit({ type: 'PassCompleted', tick: s.tick, playerId: passer, receiverId: p.id })
    if (prevTeam !== p.team) {
      s.possessionTeam = p.team
      s.possessionSinceTick = s.tick
      this.emit({ type: 'PossessionChanged', tick: s.tick, team: p.team })
    }
    // Human team: control follows the ball carrier (outfield players only).
    // Human team: control follows the ball carrier, including the keeper (throws / feet play).
    if (p.team === s.humanTeam) this.setControlled(p.id)
    else if (s.humanTeam !== null && p.team !== s.humanTeam && s.control.defensiveSwitch === 'assisted')
      this.autoSwitchDefender()

    // Execute a buffered one-touch action.
    const buf = p.buffered
    if (buf) {
      p.buffered = null
      if (buf.kind === 'pass' && buf.chip) this.chip(p, buf.dir, buf.power ?? 0)
      else if (buf.kind === 'pass') this.pass(p, buf.dir, buf.through, null, buf.power)
      else this.shoot(p, buf.dir, buf.power)
    }
  }

  // ---------------------------------------------------------------- ball physics + contacts

  private updateBall(): void {
    const s = this.state
    const b = s.ball
    if (b.mode === 'dead') return
    // A ball held in the hands is carried, not simulated.
    if (b.inHands) return
    stepBall(b, DT, {
      onSubstep: (ball) => (s.phase === 'play' && ball.mode === 'free' ? this.ballContacts(ball) : false),
      onPostHit: (speed) => this.emit({ type: 'PostHit', tick: s.tick, speed }),
      onWallHit: (speed) => this.emit({ type: 'WallHit', tick: s.tick, speed }),
      onBounce: (speed) => this.emit({ type: 'BallBounced', tick: s.tick, speed }),
    })
    if (s.phase !== 'play') return
    // Indirect free kick: once anybody else has touched the ball, a goal counts again.
    if (s.indirectKickBy !== null && b.lastTouchId !== s.indirectKickBy) s.indirectKickBy = null

    const goal = isGoal(b)
    if (goal !== 0 && s.indirectKickBy !== null) {
      // Straight into the goal from an indirect free kick: no goal, goal clearance to the defenders.
      const defending: TeamId = s.teams[0].attackDir === goal ? 1 : 0
      s.indirectKickBy = null
      this.beginRestart('goalClearance', defending, { x: 0, y: goal * (COURT.halfLength - 1.2) }, true)
      return
    }
    if (goal !== 0) {
      // Goal at +y is scored by the team attacking +y.
      const team: TeamId = s.teams[0].attackDir === goal ? 0 : 1
      s.score[team]++
      b.ownerId = null
      b.mode = 'free'
      s.phase = 'goal'
      s.phaseTimer = 0
      const scorer = b.lastTouchId !== null && this.player(b.lastTouchId).team === team ? b.lastTouchId : null
      this.emit({ type: 'GoalScored', tick: s.tick, team, scorerId: scorer, score: [s.score[0], s.score[1]] })
      return
    }

    const out = checkOutOfPlay(b)
    if (out) {
      const lastTeam = b.lastTouchTeam ?? 0
      const other: TeamId = lastTeam === 0 ? 1 : 0
      if (out.line === 'side') {
        const spot = {
          x: Math.sign(out.x) * COURT.halfWidth,
          y: clamp(out.y, -COURT.halfLength + 0.3, COURT.halfLength - 0.3),
        }
        this.beginRestart('kickIn', other, spot, true)
      } else {
        // Which team defends this goal line?
        const defending: TeamId = s.teams[0].attackDir === Math.sign(out.y) ? 1 : 0
        if (lastTeam === defending) {
          const attacking: TeamId = defending === 0 ? 1 : 0
          this.beginRestart(
            'corner',
            attacking,
            {
              x: Math.sign(out.x || 1) * (COURT.halfWidth - 0.15),
              y: Math.sign(out.y) * (COURT.halfLength - 0.15),
            },
            true,
          )
        } else {
          const gy = Math.sign(out.y) * (COURT.halfLength - 1.2)
          this.beginRestart('goalClearance', defending, { x: clamp(out.x, -2.5, 2.5), y: gy }, true)
        }
      }
    }
  }

  /** Player interactions with a free ball during a physics substep. Returns true if the ball changed. */
  private ballContacts(b: BallState): boolean {
    const s = this.state
    for (const p of s.players) {
      if (p.id === b.blockedTouchId) continue
      const dx = b.pos.x - p.pos.x
      const dy = b.pos.y - p.pos.y
      const d = Math.hypot(dx, dy)
      // Goal clearance: the released ball touched by anybody before it has left the penalty area —
      // retaken (the keeper's throw must clear the area; nobody may block it inside).
      const cl = s.clearance
      if (
        cl &&
        cl.released &&
        p.touchCooldown <= 0 &&
        d < playerRadius(p) + BALL.radius + 0.25 &&
        b.z < PLAYER.ballContactHeight &&
        this.inClearanceArea(b.pos)
      ) {
        this.emit({ type: 'ClearanceRetaken', tick: s.tick, team: cl.team, playerId: p.id })
        this.beginRestart('goalClearance', cl.team, cl.spot)
        return true
      }
      if (p.touchCooldown > 0) {
        // Even after a failed save attempt the keeper's body still stops the ball (no passing through).
        if (p.role === 'GK' && p.action === 'save' && d < playerRadius(p) + BALL.radius && b.z < 1.9) {
          const n = d > 1e-6 ? { x: dx / d, y: dy / d } : { x: 0, y: -s.teams[p.team].attackDir }
          if (b.vel.x * n.x + b.vel.y * n.y < 0) {
            // A block, not a clean save: the ball is still pushed away from goal, more weakly.
            this.parryAway(p, b, len(b.vel), 0.6)
            this.emit({ type: 'Save', tick: s.tick, playerId: p.id, caught: false })
            return true
          }
        }
        continue
      }

      if (p.role === 'GK' && b.lastTouchTeam !== p.team && this.goalkeeperSave(p, b, d)) return true
      // Second-possession rule: a keeper who released the ball in the own half may not play it again
      // there before an opponent has touched it (only an involuntary rebound off the body).
      const retouchBanned = p.id === b.keeperRetouchId && this.inOwnHalf(p)
      // An opponent's shot reaches the keeper only through the save logic above (catch, parry or
      // block): never via an ordinary first touch, which would bypass the catch rules.
      const keeperFacingShot = p.role === 'GK' && b.isShot && b.lastTouchTeam !== p.team

      const bodyR = playerRadius(p) + BALL.radius
      // Coming to meet a pass does not make it harder to control (the foot cushions it): the part of
      // his movement towards the ball is left out of the relative speed for passes and loose balls.
      let pv = p.vel
      const bs = len(b.vel)
      if (!b.isShot && bs > 0.5) {
        const along = (p.vel.x * b.vel.x + p.vel.y * b.vel.y) / bs
        if (along < 0) pv = { x: p.vel.x - (b.vel.x / bs) * along, y: p.vel.y - (b.vel.y / bs) * along }
      }
      const rel = Math.hypot(b.vel.x - pv.x, b.vel.y - pv.y)
      const pickupR = p.role === 'GK' ? 0.62 : CONTROL.pickupRadius
      // An opponent's shot hitting an outfield defender is a block: it rebounds off him (leg or
      // body), it is not brought under control. Only a weak, slow shot can be stopped.
      if (
        p.role !== 'GK' &&
        b.isShot &&
        b.lastTouchTeam !== p.team &&
        rel > CONTROL.blockControlSpeed &&
        d < pickupR &&
        b.z < PLAYER.ballContactHeight
      ) {
        const n = d > 1e-6 ? { x: dx / d, y: dy / d } : normalize({ x: -b.vel.x, y: -b.vel.y })
        this.deflect(p, b, n.x, n.y)
        return true
      }
      if (!retouchBanned && !keeperFacingShot && d < pickupR && b.z < PLAYER.ballContactHeight) {
        const a = p.profile.attributes
        // A teammate's pass is expected and taken cleanly even when firm; an opponent stepping into a
        // firm pass often gets only a touch on it and it bounces off him.
        const opponentsBall = b.lastTouchTeam !== null && b.lastTouchTeam !== p.team && !b.isShot
        const clean = opponentsBall ? CONTROL.opponentCleanSpeed : CONTROL.cleanControlSpeed
        if (rel <= clean) {
          this.giveBall(p)
          return true
        }
        if (rel < CONTROL.maxControlSpeed) {
          const t = (rel - clean) / (CONTROL.maxControlSpeed - clean)
          const chance = clamp(1 - t * attr(a.firstTouch, 1.1, 0.55) * (opponentsBall ? 1.6 : 1), 0.05, 1)
          if (this.rng.chance(chance)) {
            // A controlled but heavy first touch: the ball bounces off the foot a few metres away.
            if (p.role !== 'GK' && this.rng.chance(t * attr(a.firstTouch, 0.55, 0.12))) {
              this.heavyTouch(p, b, rel)
              return true
            }
            this.giveBall(p)
            return true
          }
          if (opponentsBall && p.role !== 'GK') {
            // Not controlled: it strikes his foot or shin and bounces away.
            this.deflect(p, b, dx / (d || 1), dy / (d || 1))
            return true
          }
        }
      }
      if (d < bodyR && b.z < 1.8) {
        this.deflect(p, b, dx / (d || 1), dy / (d || 1))
        return true
      }
    }
    return false
  }

  /** Heavy first touch: the ball is touched but runs on, slowed, in roughly its own direction. */
  private heavyTouch(p: PlayerState, b: BallState, rel: number): void {
    const dir = normalize(b.vel)
    const spd = clamp(rel * this.rng.range(0.22, 0.36), 2, 5.5)
    const ang = Math.atan2(dir.y, dir.x) + this.rng.range(-0.6, 0.6)
    b.vel = add(fromAngle(ang, spd), { x: p.vel.x * 0.4, y: p.vel.y * 0.4 })
    b.z = 0
    b.vz = Math.max(0, b.vz * 0.2)
    const intercepted = b.lastTouchTeam !== p.team
    this.updateKeeperRetouch(p)
    b.mode = 'free'
    b.ownerId = null
    b.lastKickerId = null
    b.blockedTouchId = null
    b.lastTouchId = p.id
    b.lastTouchTeam = p.team
    b.intendedReceiverId = null
    b.isShot = false
    p.touchCooldown = 0.22
    this.emit({ type: 'BallKicked', tick: this.state.tick, playerId: p.id, speed: spd })
    if (intercepted)
      this.emit({ type: 'BallIntercepted', tick: this.state.tick, playerId: p.id, team: p.team })
  }

  private deflect(p: PlayerState, b: BallState, nx: number, ny: number): void {
    const vn = b.vel.x * nx + b.vel.y * ny
    let vx = b.vel.x
    let vy = b.vel.y
    if (vn < 0) {
      vx -= 1.3 * vn * nx
      vy -= 1.3 * vn * ny
    }
    const keep = 0.45
    b.vel = {
      x: vx * keep + p.vel.x * 0.4 + this.rng.range(-0.6, 0.6),
      y: vy * keep + p.vel.y * 0.4 + this.rng.range(-0.6, 0.6),
    }
    b.vz = Math.max(0, b.vz * 0.3 + this.rng.range(0, 1.2))
    b.pos = {
      x: p.pos.x + nx * (playerRadius(p) + BALL.radius + 0.01),
      y: p.pos.y + ny * (playerRadius(p) + BALL.radius + 0.01),
    }
    const intercepted = b.lastTouchTeam !== p.team
    this.updateKeeperRetouch(p)
    b.lastKickerId = null
    b.blockedTouchId = null
    b.lastTouchId = p.id
    b.lastTouchTeam = p.team
    b.intendedReceiverId = null
    b.isShot = false
    p.touchCooldown = 0.18
    if (intercepted)
      this.emit({ type: 'BallIntercepted', tick: this.state.tick, playerId: p.id, team: p.team })
  }

  /** Reach-based goalkeeper save. One attempt per shot; outcome depends on reflexes, speed and reach. */
  private goalkeeperSave(gk: PlayerState, b: BallState, d: number): boolean {
    const speed = len(b.vel)
    const diving = gk.aiState === 'save'
    const reach = diving ? PLAYER.goalkeeperDiveReach : PLAYER.goalkeeperReach
    if (speed < 3 || d > reach || b.z > PLAYER.goalkeeperReachHeight) return false
    // A shot going clearly over the bar or wide of the posts is left alone.
    if (b.isShot && this.missesGoal(gk, b)) return false
    // Wait for the moment of closest approach: no early lunge while the ball is still coming closer.
    const rvx = b.vel.x - gk.vel.x
    const rvy = b.vel.y - gk.vel.y
    const toGkX = gk.pos.x - b.pos.x
    const toGkY = gk.pos.y - b.pos.y
    const rv = Math.hypot(rvx, rvy)
    const approaching = rvx * toGkX + rvy * toGkY > 0
    if (approaching && rv > 1e-6) {
      const closest = Math.abs(rvx * toGkY - rvy * toGkX) / rv
      // ...but at the latest when the ball reaches his body (a shot straight at him).
      if (closest < d - 0.08 && d > playerRadius(gk) + BALL.radius + 0.15) return false
    }
    const a = gk.profile.attributes
    const reachFrac = d / reach
    const heightPenalty = b.z > 1.6 ? 0.12 : 0
    // Reaction time: the longer the ball has travelled since the kick, the better the keeper has seen it.
    const flight = dist(b.kickPos, b.pos)
    const reactionBonus = clamp((flight - 10) / 14, 0, 1) * attr(a.gkPositioning, 0.3, 0.45)
    let p = clamp(
      attr(a.reflexes, 0.6, 0.95) +
        reactionBonus -
        Math.max(0, speed - 12) * 0.028 -
        reachFrac * reachFrac * (diving ? 0.4 : 0.45) -
        heightPenalty,
      0.05,
      0.985,
    )
    // Long-range or tight-angle shot: a keeper with a clear view saves almost everything he reaches;
    // screening ("maski") hides the ball and makes it dangerous.
    const longShot = b.isShot && b.shotLongRange
    if (longShot) {
      const screen = b.shotScreen
      const clear = SCREEN.clearSave + attr(a.reflexes, -0.03, 0.015)
      p = clamp(
        clear + (SCREEN.screenedSave - clear) * screen - reachFrac * reachFrac * 0.25 * screen,
        0.05,
        0.995,
      )
    }
    gk.touchCooldown = 0.35 // one attempt
    gk.action = 'save'
    gk.actionTime = 0
    // Mostly a standing save, steering the ball wide; a dive only for a ball towards a corner at full
    // stretch (low or mid height).
    // Judged by where the ball would cross the goal line relative to where he stands (his own
    // movement towards the ball must not turn a corner shot into a standing save).
    const lineY = -this.state.teams[gk.team].attackDir * COURT.halfLength
    const crossX = Math.abs(b.vel.y) > 0.5 ? b.pos.x + (b.vel.x * (lineY - b.pos.y)) / b.vel.y : b.pos.x
    // A dive only when he is caught off-centre (at the near post or further out wide) and the shot goes
    // accurately to the far post, out of reach from where he stands. From the middle he never dives:
    // he steers it wide standing up.
    // Judged from where he stood when the shot was struck (he may already have moved across).
    const startX = gk.shotStartX ?? gk.pos.x
    const offCentre = Math.abs(startX) > 0.6
    const farPost = Math.sign(crossX) !== Math.sign(startX) && Math.abs(crossX) > 0.9
    gk.saveDive = b.isShot && offCentre && farPost && Math.abs(crossX - startX) > 1.4 && b.z < 1.7
    gk.shotStartX = null
    // A placed low shot into the corner (a tap): reaching it is harder (the further he has to
    // stretch, the less likely) and it cannot be held.
    if (b.isShot && b.shotPlaced && !longShot) p = clamp(p - 0.3 * reachFrac, 0.05, 0.995)
    // Off his line and square to the shooter when it was struck (angle narrowed): a modest bonus.
    const startOut = gk.shotStartOut ?? 0
    gk.shotStartOut = null
    if (b.isShot && startOut > KEEPER_NARROW.from)
      p = Math.min(0.97, p + KEEPER_NARROW.bonus * Math.min(1, (startOut - KEEPER_NARROW.from) / 0.8))
    // A shot from the side, struck outside the penalty-area arc: the keeper covering his near post
    // saves almost everything — except a ball into the near top corner.
    const k = b.kickPos
    if (b.isShot && Math.abs(k.x) > 3 && !this.inOwnPenaltyArea(gk, k)) {
      const tLine = Math.abs(b.vel.y) > 0.5 ? (lineY - b.pos.y) / b.vel.y : 0
      const zAtLine = b.z + b.vz * tLine - 0.5 * BALL.gravity * tLine * tLine
      const nearTop = Math.sign(crossX) === Math.sign(k.x) && zAtLine > SIDE_SHOT.nearTopHeight
      if (!nearTop) p = Math.max(p, SIDE_SHOT.save + attr(a.reflexes, -0.03, 0.02))
    }
    if (!this.rng.chance(p)) return false
    // Catch when the ball is manageable and the keeper may use the hands (own penalty area);
    // otherwise parry it wide, away from goal.
    const clearLongShot = longShot && b.shotScreen < 0.25
    // A placed shot can only be held when it comes at him (no stretch); a firmer one when it is
    // manageable.
    const placedAtHim = b.isShot && b.shotPlaced && reachFrac < 0.45 && b.z < 1.4
    const catchable =
      (!(b.isShot && b.shotPlaced) || placedAtHim) &&
      this.inOwnPenaltyArea(gk, b.pos) &&
      (clearLongShot
        ? // Seen all the way: caught unless it is at full stretch or very high.
          b.z < 1.9 && d < PLAYER.goalkeeperReach
        : speed < attr(a.handling, 15, 21) + (flight > 15 ? 3 : 0) &&
          b.z < 1.8 &&
          d < PLAYER.goalkeeperReach * 0.85)
    this.emit({ type: 'Save', tick: this.state.tick, playerId: gk.id, caught: catchable })
    if (catchable) {
      gk.touchCooldown = 0
      b.z = 0
      b.vz = 0
      b.vel = { x: 0, y: 0 }
      this.giveBall(gk)
    } else {
      this.parryAway(gk, b, speed, 1)
    }
    return true
  }

  /**
   * Parry / block: steer the ball wide, away from the goal and towards the nearer side, where it
   * usually goes out for a corner or to a wide area instead of back into the danger zone.
   */
  private parryAway(gk: PlayerState, b: BallState, speed: number, strength: number): void {
    const dir = this.state.teams[gk.team].attackDir
    const side =
      Math.abs(b.pos.x) > 0.3 ? Math.sign(b.pos.x) : Math.sign(b.vel.x) || (this.rng.chance(0.5) ? 1 : -1)
    const lateral = speed * this.rng.range(0.3, 0.45) * strength
    const forward = speed * this.rng.range(0.06, 0.2) * strength
    b.vel = { x: side * lateral, y: dir * forward }
    b.vz = this.rng.range(0.8, 2.5) * strength
    // Out of the keeper's body so the ball does not stick to him.
    const n = normalize(b.vel)
    const sep = playerRadius(gk) + BALL.radius + 0.02
    b.pos = { x: gk.pos.x + n.x * sep, y: gk.pos.y + n.y * sep }
    b.lastKickerId = null
    b.blockedTouchId = null
    b.lastTouchId = gk.id
    b.lastTouchTeam = gk.team
    b.isShot = false
    b.intendedReceiverId = null
    gk.touchCooldown = Math.max(gk.touchCooldown, 0.3)
  }

  /** Ballistic estimate: will this ball pass over the crossbar or wide of the keeper's goal? */
  private missesGoal(gk: PlayerState, b: BallState): boolean {
    const goalY = -this.state.teams[gk.team].attackDir * COURT.halfLength
    const vy = b.vel.y
    if (Math.abs(vy) < 0.5 || Math.sign(goalY - b.pos.y) !== Math.sign(vy)) return false
    const t = (goalY - b.pos.y) / vy
    const zAt = b.z + b.vz * t - 0.5 * BALL.gravity * t * t
    const xAt = b.pos.x + b.vel.x * t
    return zAt > COURT.goalHeight + 0.05 || Math.abs(xAt) > COURT.goalHalfWidth + 0.25
  }

  /** In the player's own half (the keeper rules refer to it). */
  private inOwnHalf(p: PlayerState): boolean {
    return this.state.teams[p.team].attackDir * p.pos.y <= 0
  }

  /** An opponent of the blocked keeper touching the ball lifts the second-possession ban. */
  private updateKeeperRetouch(p: PlayerState): void {
    const b = this.state.ball
    if (b.keeperRetouchId !== null && this.player(b.keeperRetouchId).team !== p.team) b.keeperRetouchId = null
  }

  // ---------------------------------------------------------------- phases and restarts

  /**
   * Start a restart. With `ballInFlight` (the ball has just gone out) the ball keeps its trajectory
   * off the court — to the boards and back — and is placed on the spot a moment later.
   */
  private beginRestart(type: RestartType, team: TeamId, spot: Vec2, ballInFlight = false): void {
    const s = this.state
    const b = s.ball
    s.phase = 'restart'
    s.phaseTimer = 0
    b.ownerId = null
    if (ballInFlight) {
      b.mode = 'free'
    } else {
      this.placeBall(spot)
    }
    b.intendedReceiverId = null
    b.isShot = false
    b.blockedTouchId = null
    b.inHands = false
    b.handsTimer = 0
    s.indirectKickBy = null
    s.clearance = null
    let taker: PlayerState
    const teamPlayers = s.players.filter((p) => p.team === team)
    if (type === 'goalClearance') taker = teamPlayers.find((p) => p.role === 'GK')!
    else if (type === 'kickoff') taker = teamPlayers.find((p) => p.role === 'PIVOT')!
    else {
      taker = teamPlayers
        .filter((p) => p.role !== 'GK')
        .reduce((best, p) => (estimateTimeToReach(p, spot) < estimateTimeToReach(best, spot) ? p : best))
    }
    s.restart = {
      type,
      team,
      spot: { ...spot },
      takerId: taker.id,
      timer: 0,
      ready: false,
      readyTimer: 0,
      ballPlaced: !ballInFlight,
      aimDir: restartInward(s, { type, spot, team }),
    }
    for (const p of s.players) p.buffered = null
    if (team === s.humanTeam) this.setControlled(taker.id)
    if (type !== 'kickoff')
      this.emit({ type: 'BallOut', tick: s.tick, restart: type, team, spot: { ...spot } })
  }

  /**
   * Match clock. Effective time runs only in open play; a running clock also runs through stoppages.
   * When a half expires play stops at once: half-time (ends switch, the other team kicks off the
   * second half) or full time. Returns true when this tick was consumed by a break.
   */
  private updateClock(): boolean {
    const s = this.state
    if (s.phase === 'halftime') {
      s.phaseTimer += DT
      for (const p of s.players) {
        p.moveIntent = { x: 0, y: 0 }
        updatePlayerMovement(p, false, DT)
      }
      if (s.phaseTimer >= s.rules.halftimeBreak) this.startSecondHalf()
      return true
    }
    const running = s.rules.effectiveClock ? s.phase === 'play' : true
    if (running) s.clock = Math.max(0, s.clock - DT)
    if (s.clock > 0) return false
    const score: [number, number] = [s.score[0], s.score[1]]
    this.placeBall({ x: 0, y: 0 })
    s.restart = null
    s.phaseTimer = 0
    for (const p of s.players) p.buffered = null
    if (s.half === 1) {
      s.phase = 'halftime'
      this.emit({ type: 'HalfTime', tick: s.tick, score })
    } else {
      s.phase = 'fulltime'
      this.emit({ type: 'MatchFinished', tick: s.tick, score })
    }
    return true
  }

  /** Second half: teams switch ends; the team that did not kick off the first half kicks off. */
  private startSecondHalf(): void {
    const s = this.state
    for (const t of s.teams) t.attackDir = t.attackDir === 1 ? -1 : 1
    s.half = 2
    s.clock = s.rules.halfLength
    s.possessionTeam = null
    this.setupKickoff(s.firstKickoffTeam === 0 ? 1 : 0)
    this.emit({ type: 'SecondHalfStarted', tick: s.tick })
  }

  private updatePhase(): void {
    const s = this.state
    s.phaseTimer += DT
    if (s.phase === 'goal' && s.phaseTimer >= RESTART.celebrationTime) {
      const scoredAgainst =
        s.ball.pos.y > 0 ? (s.teams[0].attackDir === 1 ? 1 : 0) : s.teams[0].attackDir === 1 ? 0 : 1
      this.beginRestart('kickoff', scoredAgainst as TeamId, { x: 0, y: 0 })
      return
    }
    if (s.phase !== 'restart' || !s.restart) return
    const r = s.restart
    r.timer += DT
    if (!r.ballPlaced) {
      const speed = Math.hypot(s.ball.vel.x, s.ball.vel.y, s.ball.vz)
      const settled = speed < RESTART.outSettledSpeed && s.ball.z < 0.05
      if (r.timer >= RESTART.outFlightMax || (r.timer >= RESTART.outFlightMin && settled)) {
        // Goal clearance: if the ball came back into the keeper's area, that ball is used where it
        // stopped (the keeper fetches it) instead of a new ball appearing on the spot.
        const taker = this.player(r.takerId)
        const b = s.ball
        if (
          r.type === 'goalClearance' &&
          Math.abs(b.pos.x) < COURT.halfWidth &&
          this.inOwnPenaltyArea(taker, b.pos)
        ) {
          const dir = s.teams[taker.team].attackDir
          r.spot = { x: b.pos.x, y: dir * Math.max(dir * b.pos.y, -COURT.halfLength + 0.3) }
        }
        this.placeBall(r.spot)
        r.ballPlaced = true
      }
    }
    if (r.ready) {
      r.readyTimer += DT
      if (
        (r.type === 'kickIn' || r.type === 'corner' || r.type === 'freeKick') &&
        r.readyTimer >= RESTART.kickTimeLimit
      ) {
        // Four-second rule: kick-in to the opponents, or a goal clearance after a late corner; a
        // late free kick becomes an indirect free kick to the opponents from the same spot.
        const other: TeamId = r.team === 0 ? 1 : 0
        this.emit({ type: 'RestartTimeout', tick: s.tick, restart: r.type, team: r.team })
        if (r.type === 'kickIn') this.beginRestart('kickIn', other, r.spot)
        else if (r.type === 'freeKick') this.beginRestart('freeKick', other, r.spot)
        else
          this.beginRestart('goalClearance', other, {
            x: 0,
            y: Math.sign(r.spot.y) * (COURT.halfLength - 1.2),
          })
      }
      return
    }
    const taker = this.player(r.takerId)
    // Human taker with no input walks to the ball automatically.
    const takerSpot = restartTakerSpot(s, r)
    // At the kick-off the human taker's movement is not his own: he goes to the ball and stays there
    // (the direction keys only aim once he is at it).
    if (r.type === 'kickoff' && taker.id === s.controlledId && dist(taker.pos, takerSpot) <= 0.15) {
      taker.moveIntent = { x: 0, y: 0 }
      taker.sprint = false
    }
    if (
      taker.id === s.controlledId &&
      (r.type === 'kickoff' || len(taker.moveIntent) < 0.1) &&
      dist(taker.pos, takerSpot) > 0.15
    ) {
      const to = sub(routeAroundGoals(taker.pos, takerSpot), taker.pos)
      const n = normalize(to)
      const m = clamp(len(to) / 1.2, 0.3, 1)
      taker.moveIntent = { x: n.x * m, y: n.y * m }
      // Approach the ball facing the court (a keeper does not turn his back to play).
      if (dist(taker.pos, takerSpot) < 3) taker.faceTarget = addScaled(r.spot, restartInward(s, r), 4)
    }
    if (r.type === 'kickoff') this.returnToKickoffPositions()
    const minDelay = r.type === 'kickoff' ? 1.4 : RESTART.minRestartDelay
    const positionsOk = r.type !== 'kickoff' || this.kickoffPositionsLegal()
    if (r.ballPlaced && r.timer >= minDelay && positionsOk && dist(taker.pos, takerSpot) < 0.3) {
      s.ball.mode = 'free'
      taker.touchCooldown = 0
      if (r.type === 'goalClearance') {
        // The keeper restarts by gathering the ball and distributing it. He picks it up facing the
        // court (not his own goal, whatever way he walked to the ball), ball in his hands in front.
        s.phase = 'play'
        s.restart = null
        taker.facing = s.teams[taker.team].attackDir === 1 ? Math.PI / 2 : -Math.PI / 2
        taker.faceTarget = null
        this.giveBall(taker)
        s.ball.inHands = true
        s.ball.pos = addScaled(taker.pos, fromAngle(taker.facing), HANDS.forward)
        s.ball.z = HANDS.height
        s.ball.vz = 0
        taker.aiHoldTimer = 0.1
        s.clearance = { team: taker.team, released: false, spot: { ...r.spot } }
        this.emit({ type: 'PlayResumed', tick: s.tick })
      } else {
        // Kick-in / corner / kick-off: the taker is at the ball; play resumes with the kick.
        r.ready = true
        r.readyTimer = 0
        this.giveBall(taker)
        taker.aiHoldTimer = 0
      }
    }
  }

  /**
   * Kick-off positions: every player in their own half, and the defending team outside the centre
   * circle. Players returning from the other half may walk back, but nobody may cross into the
   * opponent half or into the circle while the kick-off is pending.
   */
  private enforceKickoffPositions(prev: { x: number; y: number }[]): void {
    const s = this.state
    const r = s.restart
    if (!r) return
    const circle = COURT.centerCircleRadius + PLAYER.radius
    for (const p of s.players) {
      const dir = s.teams[p.team].attackDir
      const was = prev[p.id]!
      // Own-half line (the taker may stand on the centre spot).
      if (p.id === r.takerId && Math.hypot(p.pos.x - r.spot.x, p.pos.y - r.spot.y) < 0.6) continue
      const limit = p.id === r.takerId ? 0.05 : -PLAYER.radius
      if (dir * p.pos.y > limit && dir * was.y <= limit + 1e-9) {
        p.pos = { x: p.pos.x, y: dir * limit }
        if (dir * p.vel.y > 0) p.vel = { x: p.vel.x, y: 0 }
      }
      if (p.team !== r.team) {
        const d = Math.hypot(p.pos.x, p.pos.y)
        const dWas = Math.hypot(was.x, was.y)
        if (d < circle && dWas >= circle - 1e-9) {
          const k = circle / (d || 1)
          p.pos = d > 1e-6 ? { x: p.pos.x * k, y: p.pos.y * k } : { x: 0, y: -dir * circle }
        }
      }
    }
  }

  /**
   * Inside the keeper's own penalty area: 6 m quarter circles around the posts joined by a straight
   * line (the court markings), at the end the keeper's team defends.
   */
  inOwnPenaltyArea(p: PlayerState, pos: Vec2): boolean {
    const dir = this.state.teams[p.team].attackDir
    const depth = COURT.halfLength + dir * pos.y // distance in front of own goal line
    if (depth < -0.2 || Math.abs(pos.x) > COURT.halfWidth) return false
    const ax = Math.abs(pos.x)
    const r = COURT.penaltyAreaRadius
    return ax <= POST_X ? depth <= r : Math.hypot(ax - POST_X, Math.max(0, depth)) <= r
  }

  /**
   * Spot of an indirect free kick for an offence at `pos` by `offenders`: where it happened, but an
   * offence inside the offending team's penalty area is moved to the nearest point on the area line.
   */
  freeKickSpot(offenders: TeamId, pos: Vec2): Vec2 {
    const dir = this.state.teams[offenders].attackDir
    const goalY = -dir * COURT.halfLength
    const r = COURT.penaltyAreaRadius + 0.05
    const keeper = this.state.players.find((p) => p.team === offenders && p.role === 'GK')!
    let spot = { ...pos }
    if (this.inOwnPenaltyArea(keeper, pos)) {
      const ax = Math.abs(pos.x)
      if (ax <= POST_X) spot = { x: pos.x, y: goalY + dir * r }
      else {
        const c = { x: Math.sign(pos.x) * POST_X, y: goalY }
        let n = normalize(sub(pos, c))
        if (n.y * dir < 0) n = { x: Math.sign(pos.x), y: 0 }
        spot = addScaled(c, n, r)
      }
    }
    return {
      x: clamp(spot.x, -COURT.halfWidth + 0.3, COURT.halfWidth - 0.3),
      y: clamp(spot.y, -COURT.halfLength + 0.3, COURT.halfLength - 0.3),
    }
  }

  /** Goal clearance: inside the clearing team's own penalty area. */
  private inClearanceArea(pos: Vec2): boolean {
    const cl = this.state.clearance
    if (!cl) return false
    const keeper = this.state.players.find((q) => q.team === cl.team && q.role === 'GK')!
    return this.inOwnPenaltyArea(keeper, pos)
  }

  /** The released goal-clearance ball has left the penalty area: normal play from now on. */
  private updateClearance(): void {
    const s = this.state
    const cl = s.clearance
    if (!cl || s.phase !== 'play') return
    if (cl.released && !s.ball.inHands && !this.inClearanceArea(s.ball.pos)) s.clearance = null
  }

  /**
   * Kick-in, corner and free kick: opponents keep their distance from the ball until it is played —
   * also the human-controlled player, who is walked out of the circle and cannot step back in (he
   * would otherwise block the kick from right next to the ball).
   */
  private enforceRestartDistance(): void {
    const s = this.state
    // Goal clearance in progress (keeper has not released it): opponents — the human player as well
    // — are walked out of the penalty area; nobody may block the keeper's throw.
    const cl = s.clearance
    if (cl && !cl.released && s.phase === 'play') {
      for (const p of s.players) {
        if (p.team === cl.team || !this.inClearanceArea(p.pos)) continue
        const out = outsideClearanceArea(s, p.pos, cl.team)
        const off = sub(out, p.pos)
        const d = len(off)
        if (d < 1e-3) continue
        const n = normalize(off)
        p.pos = addScaled(p.pos, n, Math.min(d, 4 * DT))
        const inward = p.vel.x * n.x + p.vel.y * n.y
        if (inward < 0) p.vel = { x: p.vel.x - n.x * inward, y: p.vel.y - n.y * inward }
      }
    }
    const r = s.restart
    if (s.phase !== 'restart' || !r || (r.type !== 'kickIn' && r.type !== 'corner' && r.type !== 'freeKick'))
      return
    const radius = RESTART.opponentDistance
    for (const p of s.players) {
      if (p.team === r.team || p.role === 'GK') continue
      const off = sub(p.pos, r.spot)
      const d = len(off)
      if (d >= radius) continue
      const n = d > 1e-3 ? normalize(off) : { x: -Math.sign(r.spot.x) || 1, y: 0 }
      // Out at walking pace, and no velocity towards the ball.
      const step = Math.min(radius - d, 4 * DT)
      p.pos = addScaled(p.pos, n, step)
      const inward = p.vel.x * n.x + p.vel.y * n.y
      if (inward < 0) p.vel = { x: p.vel.x - n.x * inward, y: p.vel.y - n.y * inward }
    }
  }

  /** Put a (new) ball at rest on a restart spot. */
  private placeBall(spot: Vec2): void {
    const b = this.state.ball
    b.mode = 'dead'
    b.ownerId = null
    b.pos = { ...spot }
    b.z = 0
    b.vz = 0
    b.vel = { x: 0, y: 0 }
    b.spin = 0
    b.inHands = false
    b.keeperRetouchId = null
    b.lastKickerId = null
  }

  /** Is this player legally placed for the pending kick-off? */
  private kickoffPositionLegal(p: PlayerState): boolean {
    const s = this.state
    const r = s.restart
    if (!r) return true
    const dir = s.teams[p.team].attackDir
    // The taker stands at the ball on the centre spot, whichever side of the line they approached from.
    if (p.id === r.takerId && Math.hypot(p.pos.x - r.spot.x, p.pos.y - r.spot.y) < 0.6) return true
    if (dir * p.pos.y > 0) return false
    if (p.team !== r.team && Math.hypot(p.pos.x, p.pos.y) < COURT.centerCircleRadius) return false
    return true
  }

  /** True when all players are in their own half and the defending team is outside the centre circle. */
  private kickoffPositionsLegal(): boolean {
    return this.state.players.every((p) => this.kickoffPositionLegal(p))
  }

  /**
   * The human-controlled player is not moved by the AI. If they are out of position for the kick-off
   * and give no input, walk them back; after a grace period walk them back regardless, so the
   * kick-off can never be blocked forever. (AI players walk back through their own behaviour.)
   */
  private returnToKickoffPositions(): void {
    const s = this.state
    const r = s.restart
    if (!r || s.controlledId === null || s.controlledId === r.takerId) return
    const p = this.player(s.controlledId)
    if (this.kickoffPositionLegal(p)) return
    if (len(p.moveIntent) > 0.1 && r.timer < RESTART.kickoffGrace) return
    const dir = s.teams[p.team].attackDir
    const target = baseAnchor(p.role, p.team === r.team ? 'kickoffOwn' : 'kickoffOpp', dir)
    const n = normalize(sub(routeAroundGoals(p.pos, target), p.pos))
    p.moveIntent = n
    p.sprint = true
  }

  // ---------------------------------------------------------------- player switching

  private setControlled(id: number): void {
    const s = this.state
    if (s.controlledId === id) return
    if (s.controlledId !== null) {
      const prev = this.player(s.controlledId)
      prev.moveIntent = { x: 0, y: 0 }
      prev.sprint = false
      prev.sole = false
      prev.aiState = ''
    }
    s.controlledId = id
    this.emit({ type: 'PlayerSwitched', tick: s.tick, playerId: id })
  }

  /** Manual switch: best time-to-ball, biased by stick direction; never the keeper or the current player. */
  private manualSwitch(dir: Vec2): void {
    const s = this.state
    if (s.humanTeam === null || s.switchCooldown > 0) return
    if (s.ball.ownerId !== null && s.ball.ownerId === s.controlledId) return
    const target = s.ball.ownerId !== null ? this.player(s.ball.ownerId).pos : s.ball.pos
    const hasDir = len(dir) > 0.3
    let best: PlayerState | null = null
    let bestScore = Infinity
    for (const p of s.players) {
      if (p.team !== s.humanTeam || p.role === 'GK' || p.id === s.controlledId) continue
      let score = estimateTimeToReach(p, target)
      if (hasDir) {
        const to = normalize(sub(p.pos, this.player(s.controlledId ?? p.id).pos))
        score -= (to.x * dir.x + to.y * dir.y) * 0.8
      }
      if (score < bestScore) {
        bestScore = score
        best = p
      }
    }
    if (best) {
      this.setControlled(best.id)
      s.switchCooldown = PLAYER.switchCooldown
      s.autoSwitchHold = SWITCHING.manualHold
    }
  }

  /** True when the human team is without the ball (opponent possession, opponent restart, opponent loose ball). */
  private humanDefending(): boolean {
    const s = this.state
    const b = s.ball
    if (s.humanTeam === null) return false
    if (s.phase === 'restart') return s.restart !== null && s.restart.team !== s.humanTeam
    if (s.phase !== 'play') return false
    if (b.ownerId !== null) return this.player(b.ownerId).team !== s.humanTeam
    if (b.intendedReceiverId !== null && this.player(b.intendedReceiverId).team === s.humanTeam) return false
    return b.lastTouchTeam !== s.humanTeam
  }

  /**
   * `nearest` defensive switching: while defending, control follows the outfield player nearest the
   * ball, with distance hysteresis and a cooldown so it never flickers. A manual switch pauses it.
   */
  private updateNearestDefenderSwitch(): void {
    const s = this.state
    if (s.control.defensiveSwitch !== 'nearest' || s.controlledId === null) return
    if (s.switchCooldown > 0 || s.autoSwitchHold > 0 || !this.humanDefending()) return
    const current = this.player(s.controlledId)
    if (current.action === 'tackle') return
    const target = s.ball.pos
    let best: PlayerState | null = null
    let bestD = dist(current.pos, target) - SWITCHING.nearestHysteresis
    for (const p of s.players) {
      if (p.team !== s.humanTeam || p.role === 'GK' || p.id === current.id) continue
      const d = dist(p.pos, target)
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    if (best) {
      this.setControlled(best.id)
      s.switchCooldown = SWITCHING.autoCooldown
    }
  }

  /** After losing the ball, hand control to a defender who can actually influence play. */
  private autoSwitchDefender(): void {
    const s = this.state
    if (s.humanTeam === null || s.ball.ownerId === null) return
    const carrier = this.player(s.ball.ownerId)
    const ranked = s.players
      .filter((p) => p.team === s.humanTeam && p.role !== 'GK')
      .map((p) => ({ p, t: estimateTimeToReach(p, carrier.pos) }))
      .sort((a, b) => a.t - b.t || a.p.id - b.p.id)
    if (ranked.length === 0) return
    const current = ranked.find((r) => r.p.id === s.controlledId)
    if (!current || current.t > ranked[0]!.t + 0.5) this.setControlled(ranked[0]!.p.id)
  }

  private emit(e: MatchEvent): void {
    this.events.push(e)
    this.recordStats(e)
  }

  /** Team statistics are derived from the authoritative event stream. */
  private recordStats(e: MatchEvent): void {
    const st = this.state.stats
    const teamOf = (id: number) => this.player(id).team
    switch (e.type) {
      case 'ShotTaken':
        st[e.team].shots++
        break
      case 'Save': {
        const keeperTeam = teamOf(e.playerId)
        st[keeperTeam].saves++
        st[keeperTeam === 0 ? 1 : 0].shotsOnTarget++
        break
      }
      case 'GoalScored':
        st[e.team].goals++
        if (this.state.ball.isShot) st[e.team].shotsOnTarget++
        break
      case 'PassStarted':
        st[teamOf(e.playerId)].passes++
        break
      case 'PassCompleted':
        st[teamOf(e.playerId)].passesCompleted++
        break
      case 'BallOut':
        if (e.restart === 'corner') st[e.team].corners++
        if (e.restart === 'kickIn') st[e.team].kickIns++
        break
      default:
        break
    }
  }
}

// ------------------------------------------------------------------ setup

export function createInitialState(setup: MatchSetup): MatchState {
  const rng = new SeededRandom(deriveSeed(setup.seed, 'squads'))
  const defs = [setup.home, setup.away] as const
  const players: PlayerState[] = []
  for (let t = 0; t < 2; t++) {
    const def = defs[t]!
    for (let i = 0; i < STARTING_ROLES.length; i++) {
      const role = STARTING_ROLES[i]!
      const id = players.length
      const profile = generatePlayer(rng, id, role, STARTING_NUMBERS[i]!, def.quality, {
        ...(def.category !== 'club' ? { nation: def.nation } : {}),
        women: def.category === 'women',
      })
      // Real squads only from a local, git-ignored roster file (private local play).
      const roster = localRoster(def.id)
      const real = roster ? pickStartingFive(roster)[i] : null
      if (real) applyRosterPlayer(profile, real)
      if (setup.humanTeam !== null && t !== setup.humanTeam) {
        // Difficulty: the computer opponent's attributes are shifted (decision and execution quality).
        const off = DIFFICULTY[setup.difficulty ?? 'normal'].attributeOffset
        const attrs = { ...profile.attributes }
        for (const k of Object.keys(attrs) as (keyof typeof attrs)[]) attrs[k] = clamp(attrs[k] + off, 1, 100)
        profile.attributes = attrs
      }
      players.push({
        id,
        team: t as TeamId,
        role,
        profile,
        pos: { x: 0, y: 0 },
        vel: { x: 0, y: 0 },
        facing: t === 0 ? Math.PI / 2 : -Math.PI / 2,
        moveIntent: { x: 0, y: 0 },
        faceTarget: null,
        sprint: false,
        sole: false,
        stamina: 1,
        touchCooldown: 0,
        tackleCooldown: 0,
        action: 'none',
        actionTime: 0,
        buffered: null,
        aiTarget: { x: 0, y: 0 },
        aiDecisionTimer: (id % 6) / 60,
        aiHoldTimer: 0,
        aiBreakawayCorner: 0,
        aiChallengeTimer: 0,
        aiChallengeSide: 0,
        dribbleTouchTimer: 0,
        saveDive: false,
        shotStartX: null,
        shotStartOut: null,
        aiSetPieceTimer: 0,
        aiRunTimer: 0,
        aiRunCooldown: 0,
        aiMarkId: null,
        aiRunTarget: { x: 0, y: 0 },
        aiRecoverTimer: 0,
        aiDecision: '',
        aiState: '',
      })
    }
  }
  const team = (i: 0 | 1) => {
    const d = defs[i]
    return {
      id: i,
      name: d.name,
      shortName: d.shortName,
      primaryColor: d.primaryColor,
      secondaryColor: d.secondaryColor,
      numberColor: d.numberColor,
      attackDir: i === 0 ? (1 as const) : (-1 as const),
      tactics: { ...DEFAULT_TACTICS, ...d.tactics, ...setup.tactics?.[i] },
    }
  }
  return {
    tick: 0,
    time: 0,
    playingTime: 0,
    half: 1,
    clock: { ...DEFAULT_RULES, ...setup.rules }.halfLength,
    rules: { ...DEFAULT_RULES, ...setup.rules },
    firstKickoffTeam: 0,
    stats: [emptyStats(), emptyStats()],
    phase: 'restart',
    phaseTimer: 0,
    restart: null,
    teams: [team(0), team(1)],
    score: [0, 0],
    players,
    ball: {
      pos: { x: 0, y: 0 },
      z: 0,
      vel: { x: 0, y: 0 },
      vz: 0,
      spin: 0,
      mode: 'dead',
      ownerId: null,
      lastTouchId: null,
      lastTouchTeam: null,
      intendedReceiverId: null,
      isShot: false,
      blockedTouchId: null,
      landing: null,
      kickPos: { x: 0, y: 0 },
      kickTime: 0,
      inHands: false,
      handsTimer: 0,
      keeperRetouchId: null,
      shotScreen: 0,
      shotLongRange: false,
      shotPlaced: false,
      lastKickerId: null,
    },
    humanTeam: setup.humanTeam,
    controlledId:
      setup.humanTeam === null
        ? null
        : players.find((p) => p.team === setup.humanTeam && p.role === 'PIVOT')!.id,
    switchCooldown: 0,
    autoSwitchHold: 0,
    control: { ...DEFAULT_CONTROL_OPTIONS, ...setup.control },
    difficulty: setup.difficulty ?? 'normal',
    indirectKickBy: null,
    clearance: null,
    defTransition: [false, false],
    possessionSinceTick: 0,
    teamPhase: ['setPiece', 'setPiece'],
    aiPrevPossession: null,
    possessionTeam: null,
    rngState: 0,
  }
}

// ------------------------------------------------------------------ shot context

/** Shot from 10 m or more, or from a tight angle (the goal mouth looks narrow from the shooter). */
export function isLongRangeShot(pos: Vec2, attackDir: 1 | -1): boolean {
  const goalY = attackDir * COURT.halfLength
  if (Math.hypot(pos.x, goalY - pos.y) >= SCREEN.longRange) return true
  const a1 = Math.atan2(goalY - pos.y, POST_X - pos.x)
  const a2 = Math.atan2(goalY - pos.y, -POST_X - pos.x)
  let angle = Math.abs(a1 - a2)
  if (angle > Math.PI) angle = 2 * Math.PI - angle
  return angle < SCREEN.tightAngle
}

/**
 * How much the keeper's view of the shooter is blocked (0..1): players (either team) standing close to
 * the line between the ball and the keeper, weighted more when they are near the keeper.
 */
export function screenFactor(state: MatchState, shooter: PlayerState, keeper: PlayerState): number {
  const ax = shooter.pos.x
  const ay = shooter.pos.y
  const vx = keeper.pos.x - ax
  const vy = keeper.pos.y - ay
  const l2 = vx * vx + vy * vy
  if (l2 < 1e-6) return 0
  let best = 0
  for (const q of state.players) {
    if (q.id === shooter.id || q.id === keeper.id) continue
    const t = ((q.pos.x - ax) * vx + (q.pos.y - ay) * vy) / l2
    if (t < 0.12 || t > 0.97) continue
    const px = ax + vx * t
    const py = ay + vy * t
    const perp = Math.hypot(q.pos.x - px, q.pos.y - py)
    if (perp >= SCREEN.lineWidth) continue
    const toKeeper = Math.hypot(keeper.pos.x - q.pos.x, keeper.pos.y - q.pos.y)
    const near = toKeeper < 3 ? 1 : toKeeper < 9 ? 1 - ((toKeeper - 3) / 6) * 0.6 : 0.4
    best = Math.max(best, (1 - perp / SCREEN.lineWidth) * near)
  }
  return clamp(best, 0, 1)
}
