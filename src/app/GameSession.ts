import { CAMERA_PRESET_ORDER, type CameraPresetId } from '../camera/CameraSettings'
import { TEAM_LIBRARY } from '../data/teams'
import { InputManager } from '../input/InputManager'
import { ThreeRenderer, graphicsFromUrl } from '../rendering/ThreeRenderer'
import { Radar } from '../rendering/Radar'
import { PITCH_GRID, pitchControl } from '../ai/spatial/PitchControl'
import type { MatchEvent } from '../simulation/Events'
import { MatchSimulation } from '../simulation/MatchSimulation'
import { copySnapshot, createSnapshot, writeSnapshot, type MatchSnapshot } from '../simulation/MatchSnapshot'
import { DT, HANDS, MAX_FRAME_TIME, RESTART } from '../simulation/SimulationConfig'
import type { Command } from '../simulation/Commands'
import { useUi, type HudState, type LabState } from '../ui/store'
import { AIDebugOverlay, type DebugLabels } from '../rendering/AIDebugOverlay'
import { SCENARIOS, applyScenario, demoPriorities, scenarioOutcome } from '../lab/scenarios'
import type { RotationSettings } from '../ai/team/rotationLibrary'
import type { TeamId } from '../simulation/MatchState'
import { mergeTactics, type TeamTactics } from '../simulation/Tactics'
import { DICTIONARIES, translate, type TranslationKey } from '../localization/i18n'

/** Tactical Lab: pause (ticks) between an attempt's outcome and the next start. */
const LAB_REPEAT_PAUSE_TICKS = Math.round(1.4 / DT)

/** Ticks the opponent carrier's card stays up after he releases the ball (0.6 s). */
const OPPONENT_CARD_HOLD_TICKS = Math.round(0.6 / DT)

function hex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`
}

/** Debug/test hook (read-only views of the authoritative state). */
export interface DebugHook {
  getState: () => MatchSimulation['state']
  eventCounts: Record<string, number>
  frameTimeMs: number
  drawCalls: number
  /** Dev builds only: the live camera, for visual inspection (e.g. camera.zoom). */
  camera?: unknown
  /** Dev builds only: the 3D scene (e.g. to check the players' drawn size). */
  scene?: unknown
}

declare global {
  interface Window {
    __FTW__?: DebugHook
  }
}

/**
 * Fixed-timestep game loop: simulation at 60 Hz, rendering at display rate with interpolation
 * between the last two snapshots. Bounded catch-up after tab inactivity; auto-pause when hidden.
 */
export class GameSession {
  readonly sim: MatchSimulation
  private readonly renderer: ThreeRenderer
  private readonly input: InputManager
  private readonly prev: MatchSnapshot
  private readonly curr: MatchSnapshot
  private accumulator = 0
  private lastTime = -1
  private raf = 0
  private hudTimer = 0
  private disposed = false
  private readonly debug: DebugHook
  private unsubscribe: () => void
  /** Commands from the UI (e.g. settings changes), injected into the next simulation tick. */
  private pendingCommands: Command[] = []
  private readonly radar: Radar
  /** Key 7: AI debug overlay over the main view (and pitch control on the radar). */
  private readonly aiOverlay: AIDebugOverlay
  /** The opponent player last on the ball (HUD card) and the tick he last had it. */
  private lastOpponentCarrier: number | null = null
  private lastOpponentCarrierTick = 0
  /** Tactical Lab: the team with the attacking situation, and the attempt in progress. */
  private readonly labAttackTeam: TeamId = 0
  private labAttempt = { ticks: 0, done: false, doneTick: 0, rotStarted: 0, rotCompleted: 0 }

  constructor(container: HTMLElement, seed: number) {
    const setup = useUi.getState().quickMatch
    const lab = useUi.getState().lab
    // Tactical Lab: the human attacks (team 0 has the situation), defends (team 1 has it) or watches.
    if (lab) this.labAttackTeam = lab.mode === 'defend' ? 1 : 0
    const defendTeam: TeamId = this.labAttackTeam === 0 ? 1 : 0
    const labTactics: [Partial<TeamTactics>, Partial<TeamTactics>] = [{}, {}]
    if (lab) {
      labTactics[this.labAttackTeam] = {
        formation: lab.formation,
        rotations: lab.rotations,
        ...labRotation(lab),
      }
      labTactics[defendTeam] = { pressing: lab.pressing, rotations: lab.rotations }
    }
    this.sim = new MatchSimulation({
      seed,
      home: TEAM_LIBRARY[setup.homeIndex] ?? TEAM_LIBRARY[0]!,
      away: TEAM_LIBRARY[setup.awayIndex] ?? TEAM_LIBRARY[1]!,
      humanTeam: lab?.mode === 'watch' ? null : 0,
      control: useUi.getState().controls,
      // The lab never reaches half-time.
      rules: lab
        ? { halfLength: 99 * 60, effectiveClock: true }
        : { halfLength: setup.halfMinutes * 60, effectiveClock: setup.effectiveClock },
      difficulty: setup.difficulty,
      tactics: lab
        ? labTactics
        : [{ formation: setup.formation, pressing: setup.pressing, ...setup.rotation }],
    })
    if (lab) this.sim.state.drill = lab.drill
    if (lab) this.startLabAttempt()
    this.renderer = new ThreeRenderer(
      container,
      this.sim.state,
      graphicsFromUrl(window.location.search, useUi.getState().graphics),
    )
    this.radar = new Radar(container)
    this.aiOverlay = new AIDebugOverlay(container)
    this.input = new InputManager(window, useUi.getState().keyBindings)
    this.prev = createSnapshot(this.sim.state)
    this.curr = createSnapshot(this.sim.state)

    const ui = useUi.getState()
    this.applyCamera()
    this.radar.setVisible(ui.showRadar)
    this.renderer.keepHumanAttackingUp = ui.keepAttackingUp
    this.renderer.setPlayerScale(ui.playerScale)
    const [home, away] = this.sim.state.teams
    this.radar.setTeamColors(hex(home.primaryColor), hex(away.primaryColor))
    this.aiOverlay.setTeamColors(hex(home.primaryColor), hex(away.primaryColor))
    this.aiOverlay.setVisible(ui.aiDebug)
    ui.setHud({
      homeName: home.name,
      awayName: away.name,
      homeShort: home.shortName,
      awayShort: away.shortName,
      homeColor: hex(home.primaryColor),
      awayColor: hex(away.primaryColor),
      score: [0, 0],
      clock: this.sim.state.clock,
      half: 1,
    })
    this.unsubscribe = useUi.subscribe((s, p) => {
      if (s.cameraPreset !== p.cameraPreset || s.customCamera !== p.customCamera) this.applyCamera()
      if (s.showRadar !== p.showRadar) this.radar.setVisible(s.showRadar)
      if (s.keepAttackingUp !== p.keepAttackingUp) this.renderer.keepHumanAttackingUp = s.keepAttackingUp
      if (s.playerScale !== p.playerScale) this.renderer.setPlayerScale(s.playerScale)
      if (s.paused !== p.paused) this.input.reset()
      if (s.keyBindings !== p.keyBindings) this.input.setBindings(s.keyBindings)
      if (s.controls !== p.controls)
        this.pendingCommands.push({ type: 'SetControlOptions', options: s.controls })
      if (s.aiDebug !== p.aiDebug) this.aiOverlay.setVisible(s.aiDebug)
      if (s.lab && p.lab && s.matchKey === p.matchKey) this.labChanged(s.lab, p.lab)
    })
    if (lab) window.addEventListener('keydown', this.onLabKey)

    this.debug = { getState: () => this.sim.state, eventCounts: {}, frameTimeMs: 0, drawCalls: 0 }
    if (import.meta.env.DEV) {
      this.debug.camera = this.renderer.cameraController.camera
      this.debug.scene = this.renderer.scene
    }
    window.__FTW__ = this.debug
    document.addEventListener('visibilitychange', this.onVisibility)
    this.raf = requestAnimationFrame(this.frame)
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    document.removeEventListener('visibilitychange', this.onVisibility)
    window.removeEventListener('keydown', this.onLabKey)
    this.unsubscribe()
    this.input.dispose()
    this.renderer.dispose()
    this.radar.dispose()
    this.aiOverlay.dispose()
    if (window.__FTW__ === this.debug) delete window.__FTW__
  }

  private onVisibility = (): void => {
    if (document.hidden && useUi.getState().screen === 'match') useUi.getState().setPaused(true)
  }

  private frame = (now: number): void => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.frame)
    const t0 = performance.now()
    const dt = this.lastTime < 0 ? DT : Math.min((now - this.lastTime) / 1000, MAX_FRAME_TIME)
    this.lastTime = now

    this.handleUiPresses()
    const ui = useUi.getState()
    if (!ui.paused) {
      // The Tactical Lab can run the simulation slower (or faster) than real time.
      this.accumulator += dt * (ui.lab?.speed ?? 1)
      while (this.accumulator >= DT) {
        this.input.setThrowMode(this.humanKeeperHolding())
        this.input.setPassCharge(this.humanOnBall())
        const commands = this.input.sample(this.renderer.cameraController.getBasis())
        if (this.pendingCommands.length) commands.push(...this.pendingCommands.splice(0))
        copySnapshot(this.curr, this.prev)
        this.sim.step(commands)
        writeSnapshot(this.sim.state, this.curr)
        const events = this.sim.drainEvents()
        this.handleEvents(events)
        if (ui.lab) this.labTick(events)
        this.accumulator -= DT
      }
    }
    const alpha = ui.paused ? 1 : this.accumulator / DT
    this.renderer.render(
      this.prev,
      this.curr,
      alpha,
      ui.paused ? 0 : dt,
      this.humanKeeperHolding() ? this.input.shotCharge : null,
    )

    const cam = this.renderer.cameraController
    const range = cam.visibleRange()
    this.radar.draw(this.curr, {
      upSign: cam.upSign,
      orientation: cam.settings.orientation,
      visibleMinY: range.minY,
      visibleMaxY: range.maxY,
      ...(ui.aiDebug
        ? {
            pitchControl: { ...PITCH_GRID, team0: pitchControl(this.sim.state).team0 },
            phases: [this.sim.state.teamPhase[0], this.sim.state.teamPhase[1]] as [string, string],
          }
        : {}),
    })
    this.aiOverlay.draw(this.sim.state, cam.camera, this.debugLabels)

    this.hudTimer += dt
    if (this.hudTimer >= 0.1) {
      this.hudTimer = 0
      this.pushHud()
    }
    this.debug.frameTimeMs = performance.now() - t0
    this.debug.drawCalls = this.renderer.drawCalls
  }

  /** Overlay labels in the UI language (unknown codes are shown as they are). */
  private readonly debugLabels: DebugLabels = {
    label: (key) => {
      const k = `debug.${key}`
      return k in DICTIONARIES.en
        ? translate(useUi.getState().lang, k as TranslationKey)
        : key.split('.').pop()!
    },
  }

  // ------------------------------------------------------------------------------ Tactical Lab

  /** Place the scenario (again) and start counting a new attempt. */
  private startLabAttempt(): void {
    const lab = useUi.getState().lab
    if (!lab) return
    const s = this.sim.state
    const sc = SCENARIOS[lab.scenario]
    applyScenario(s, sc, this.labAttackTeam)
    this.sim.drainEvents()
    const stats = sc.rotation ? s.rotationStats[this.labAttackTeam][sc.rotation] : null
    this.labAttempt = {
      ticks: 0,
      done: false,
      doneTick: 0,
      rotStarted: stats?.started ?? 0,
      rotCompleted: stats?.completed ?? 0,
    }
    // No interpolation streak or camera sweep from where the last attempt ended.
    if (this.renderer) {
      writeSnapshot(s, this.curr)
      copySnapshot(this.curr, this.prev)
      this.renderer.snapCamera()
    }
  }

  /** Per tick in the lab: detect the attempt's outcome, record it, start again after a pause. */
  private labTick(events: MatchEvent[]): void {
    const ui = useUi.getState()
    const lab = ui.lab!
    const a = this.labAttempt
    a.ticks++
    if (!a.done) {
      const sc = SCENARIOS[lab.scenario]
      const outcome = scenarioOutcome(events, this.labAttackTeam, a.ticks * DT, sc)
      if (outcome) {
        a.done = true
        a.doneTick = a.ticks
        const stats = sc.rotation ? this.sim.state.rotationStats[this.labAttackTeam][sc.rotation] : null
        ui.recordLabAttempt(
          outcome,
          stats !== null && stats.started > a.rotStarted,
          stats !== null && stats.completed > a.rotCompleted,
        )
        ui.showFlash({
          key: 'tlab.outcome',
          vars: { outcome: `outcome.${outcome}` },
          until: performance.now() + 1400,
          info: true,
        })
      }
    } else if (lab.autoRepeat && a.ticks - a.doneTick > LAB_REPEAT_PAUSE_TICKS) this.startLabAttempt()
  }

  /** Lab settings changed in the panel: start again, or change the tactics of the running attempt. */
  private labChanged(lab: LabState, prev: LabState): void {
    const attack = this.labAttackTeam
    const defend: TeamId = attack === 0 ? 1 : 0
    if (
      lab.formation !== prev.formation ||
      lab.rotations !== prev.rotations ||
      lab.rotation !== prev.rotation ||
      lab.demo !== prev.demo ||
      lab.scenario !== prev.scenario
    )
      this.pendingCommands.push({
        type: 'SetTactics',
        team: attack,
        tactics: { formation: lab.formation, rotations: lab.rotations, ...labRotation(lab) },
      })
    if (lab.pressing !== prev.pressing || lab.rotations !== prev.rotations)
      this.pendingCommands.push({
        type: 'SetTactics',
        team: defend,
        tactics: { pressing: lab.pressing, rotations: lab.rotations },
      })
    if (lab.drill !== prev.drill) this.sim.state.drill = lab.drill
    if (lab.resetNonce !== prev.resetNonce) {
      // A new scenario brings its own tactics: apply them before placing it.
      this.sim.state.teams[attack].tactics = mergeTactics(this.sim.state.teams[attack].tactics, {
        formation: lab.formation,
        rotations: lab.rotations,
        ...labRotation(lab),
      })
      this.sim.state.teams[defend].tactics = {
        ...this.sim.state.teams[defend].tactics,
        pressing: lab.pressing,
        rotations: lab.rotations,
      }
      this.startLabAttempt()
    }
  }

  /** R starts the lab scenario again (not while typing in a panel field). */
  private onLabKey = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement | null)?.tagName
    if (e.code !== 'KeyR' || e.repeat || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
    useUi.getState().resetLabScenario()
  }

  /** Camera preset, or the Camera Lab's custom settings. */
  private applyCamera(): void {
    const ui = useUi.getState()
    if (ui.cameraPreset === 'custom') this.renderer.setCameraSettings(ui.customCamera)
    else this.renderer.setCameraPreset(ui.cameraPreset)
  }

  /** The human-controlled keeper has the ball (hands or feet) in the own half: four-second rule. */
  private humanKeeperOnBall(): boolean {
    const s = this.sim.state
    if (s.controlledId === null || s.ball.ownerId !== s.controlledId) return false
    const p = this.sim.player(s.controlledId)
    return p.role === 'GK' && s.teams[p.team].attackDir * p.pos.y <= 0
  }

  /**
   * The controlled player has the ball at his feet, or it is on its way to him: the pass and chip
   * keys charge power (otherwise the pass key tackles at once).
   */
  private humanOnBall(): boolean {
    const s = this.sim.state
    const id = s.controlledId
    if (id === null || s.ball.inHands) return false
    if (s.ball.ownerId === id) return true
    return s.ball.ownerId === null && s.ball.intendedReceiverId === id
  }

  /** The human-controlled keeper holds the ball in the hands (throw mode). */
  private humanKeeperHolding(): boolean {
    const s = this.sim.state
    return s.controlledId !== null && s.ball.inHands && s.ball.ownerId === s.controlledId
  }

  private handleUiPresses(): void {
    const ui = useUi.getState()
    for (const a of this.input.takeUiPresses()) {
      if (a === 'pause') ui.setPaused(!ui.paused)
      else if (a === 'help') ui.toggleHelp()
      else if (a === 'cameraLab') ui.toggleCameraLab()
      else if (a === 'aiDebug') ui.toggleAiDebug()
      else if (a === 'camera') {
        const i = CAMERA_PRESET_ORDER.indexOf(ui.cameraPreset)
        const next: CameraPresetId = CAMERA_PRESET_ORDER[(i + 1) % CAMERA_PRESET_ORDER.length]!
        ui.setCameraPreset(next)
        ui.showFlash({
          key: 'hud.camera',
          vars: { name: `camera.${next}` },
          until: performance.now() + 1500,
          info: true,
        })
      }
    }
  }

  private handleEvents(events: MatchEvent[]): void {
    const ui = useUi.getState()
    for (const e of events) {
      this.debug.eventCounts[e.type] = (this.debug.eventCounts[e.type] ?? 0) + 1
      if (e.type === 'GoalScored') {
        const scorer = e.scorerId !== null ? this.sim.player(e.scorerId).profile : null
        ui.showFlash(
          scorer
            ? {
                key: 'hud.goalBy',
                vars: {
                  name: scorer.firstName ? `${scorer.firstName[0]}. ${scorer.lastName}` : scorer.lastName,
                },
                until: performance.now() + 2400,
              }
            : { key: 'hud.goal', until: performance.now() + 2400 },
        )
        ui.setHud({ score: [e.score[0], e.score[1]] })
      } else if (e.type === 'HalfTime') {
        ui.showFlash({ key: 'hud.halfTime', until: performance.now() + 2600 })
        this.input.reset()
      } else if (e.type === 'SecondHalfStarted') {
        ui.showFlash({ key: 'hud.secondHalf', until: performance.now() + 1500, info: true })
      } else if (e.type === 'MatchFinished') {
        this.input.reset()
        const s = this.sim.state
        ui.setResult({
          score: [e.score[0], e.score[1]],
          names: [s.teams[0].name, s.teams[1].name],
          colors: [hex(s.teams[0].primaryColor), hex(s.teams[1].primaryColor)],
          stats: [{ ...s.stats[0] }, { ...s.stats[1] }],
        })
      } else if (e.type === 'KeeperHoldTimeout') {
        ui.showFlash({ key: 'hud.keeperHoldTimeout', until: performance.now() + 1800, info: true })
      } else if (e.type === 'ClearanceRetaken') {
        ui.showFlash({ key: 'hud.clearanceRetaken', until: performance.now() + 1800, info: true })
      } else if (e.type === 'RestartTimeout' && e.team === this.sim.state.humanTeam) {
        ui.showFlash({ key: 'hud.restartTimeout', until: performance.now() + 1800, info: true })
      }
    }
  }

  private pushHud(): void {
    const s = this.sim.state
    const c = s.controlledId !== null ? this.sim.player(s.controlledId) : null
    useUi.getState().setHud({
      clock: s.clock,
      half: s.half,
      phase: s.phase,
      restartType: s.restart?.type ?? null,
      score: [s.score[0], s.score[1]],
      controlledName: c ? [c.profile.firstName, c.profile.lastName].filter(Boolean).join(' ') : null,
      controlledNumber: c ? c.profile.shirtNumber : null,
      controlledRole: c ? c.role : null,
      opponentCarrier: this.opponentCarrier(),
      shotCharge: this.input.shotCharge,
      keeperCountdown: this.humanKeeperOnBall()
        ? Math.max(0, HANDS.holdLimit - this.sim.state.ball.handsTimer)
        : null,
      keeperHands: this.humanKeeperHolding(),
      restartCountdown:
        s.restart?.ready &&
        (s.restart.type === 'kickIn' || s.restart.type === 'corner' || s.restart.type === 'freeKick')
          ? Math.max(0, RESTART.kickTimeLimit - s.restart.readyTimer)
          : null,
      fourSeconds: this.fourSecondCount(),
    })
  }

  /**
   * The opponent player on the ball. Kept briefly after he releases it (a pass, a shot) so the card
   * does not flicker between touches.
   */
  private opponentCarrier(): HudState['opponentCarrier'] {
    const s = this.sim.state
    const owner = s.ball.ownerId !== null ? this.sim.player(s.ball.ownerId) : null
    if (owner && s.humanTeam !== null && owner.team !== s.humanTeam) {
      this.lastOpponentCarrier = owner.id
      this.lastOpponentCarrierTick = s.tick
    } else if (
      owner ||
      s.phase !== 'play' ||
      this.lastOpponentCarrier === null ||
      s.tick - this.lastOpponentCarrierTick > OPPONENT_CARD_HOLD_TICKS
    )
      this.lastOpponentCarrier = null
    if (this.lastOpponentCarrier === null) return null
    const p = this.sim.player(this.lastOpponentCarrier)
    return {
      name: [p.profile.firstName, p.profile.lastName].filter(Boolean).join(' '),
      number: p.profile.shirtNumber,
      role: p.role,
      team: p.team,
    }
  }

  /** The four-second count in progress for either team (restart kick or keeper in his own half). */
  private fourSecondCount(): HudState['fourSeconds'] {
    const s = this.sim.state
    const r = s.restart
    if (
      s.phase === 'restart' &&
      r?.ready &&
      (r.type === 'kickIn' || r.type === 'corner' || r.type === 'freeKick')
    )
      return { elapsed: r.readyTimer, team: r.team, kind: 'restart' }
    if (s.phase !== 'play' || s.ball.ownerId === null) return null
    const owner = this.sim.player(s.ball.ownerId)
    if (owner.role !== 'GK' || s.teams[owner.team].attackDir * owner.pos.y > 0) return null
    const clearance = s.clearance !== null && s.clearance.team === owner.team
    return { elapsed: s.ball.handsTimer, team: owner.team, kind: clearance ? 'clearance' : 'keeper' }
  }
}

/** The Lab's rotation settings; in demonstration mode only the scenario's own move may be chosen. */
function labRotation(lab: LabState): RotationSettings {
  const kind = SCENARIOS[lab.scenario].rotation
  return lab.demo && kind ? { ...lab.rotation, priorities: demoPriorities(kind) } : lab.rotation
}
