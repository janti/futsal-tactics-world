import { clamp } from '../core/math/scalar'
import { clampLen, len, type Vec2 } from '../core/math/vec2'
import type { Command } from '../simulation/Commands'
import { DT, PASS, SHOT, THROW, CHIP } from '../simulation/SimulationConfig'
import { screenToSimDirection, type ScreenBasis } from '../camera/ScreenToWorld'
import {
  DEFAULT_GAMEPAD,
  DEFAULT_KEYBOARD,
  GAMEPAD_DEADZONE,
  type InputAction,
  type KeyBindings,
} from './InputMapping'

const ACTIONS = Object.keys(DEFAULT_KEYBOARD) as InputAction[]

/**
 * Collects keyboard and gamepad state and turns it into simulation commands once per fixed tick.
 * Movement is always relative to the visible screen orientation (via the camera basis).
 * Shot power is charged in simulation ticks so recorded command streams stay deterministic.
 */
export class InputManager {
  private readonly keys = new Set<string>()
  private readonly codeToAction = new Map<string, InputAction>()
  private held = new Set<InputAction>()
  private prevHeld = new Set<InputAction>()
  /**
   * Actions whose key went down since the last sample. A quick tap can go down and up between two
   * samples (low frame rates, fast fingers); latching keeps such taps from being lost.
   */
  private tapped = new Set<InputAction>()
  private shootTicks = 0
  /**
   * Throw mode: the controlled keeper holds the ball in the hands. Pass/shoot/through keys charge the
   * throw (hold for power, release to throw) and the direction keys aim instead of moving.
   */
  private throwMode = false
  private throwTicks = 0
  /** Manual passing: pass/through keys charge the pass power (hold, release to pass). */
  private passCharge = false
  private passTicks = 0
  private passThrough = false
  private lastMove: Vec2 = { x: 0, y: 0 }
  /** UI-level actions (pause, camera, help) pressed since the last poll. */
  private uiPresses: InputAction[] = []
  private readonly target: Window

  constructor(target: Window = window, bindings: KeyBindings = DEFAULT_KEYBOARD) {
    this.target = target
    this.setBindings(bindings)
    target.addEventListener('keydown', this.onKeyDown)
    target.addEventListener('keyup', this.onKeyUp)
    target.addEventListener('blur', this.onBlur)
  }

  /** Apply (re)bound keys; takes effect immediately. */
  setBindings(bindings: KeyBindings): void {
    this.codeToAction.clear()
    for (const action of ACTIONS)
      for (const code of bindings[action] ?? []) this.codeToAction.set(code, action)
    this.keys.clear()
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown)
    this.target.removeEventListener('keyup', this.onKeyUp)
    this.target.removeEventListener('blur', this.onBlur)
  }

  /** Current shot or throw charge 0..1 (for the HUD power bar and the aim arrow). */
  get shotCharge(): number {
    if (this.throwTicks > 0) return clamp((this.throwTicks * DT) / THROW.maxChargeTime, 0, 1)
    if (this.passTicks > 0)
      return clamp((this.passTicks * DT) / (this.passThrough ? CHIP.chargeTime : PASS.chargeTime), 0, 1)
    return this.shootTicks > 0 ? clamp((this.shootTicks * DT) / SHOT.maxChargeTime, 0, 1) : 0
  }

  /** True while a throw is being charged. */
  get charging(): boolean {
    return this.throwTicks > 0
  }

  /** Switch throw mode on while the controlled keeper holds the ball in the hands. */
  setThrowMode(on: boolean): void {
    if (on === this.throwMode) return
    this.throwMode = on
    this.throwTicks = 0
    // A shoot key still held from the throw must not start charging a shot for the receiver.
    this.shootTicks = !on && this.held.has('shoot') ? -1 : 0
  }

  /**
   * Charged passing on/off: while the controlled player has the ball (or it is on its way to him) the
   * pass and chip keys charge power and play on release; otherwise the pass key tackles at once.
   */
  setPassCharge(on: boolean): void {
    if (on === this.passCharge) return
    this.passCharge = on
    // Switching on keeps a charge already started (pressed just before the ball arrived).
    if (!on) this.passTicks = 0
  }

  /** Pop UI actions (pause / camera / help) that were pressed. */
  takeUiPresses(): InputAction[] {
    const p = this.uiPresses
    this.uiPresses = []
    return p
  }

  /** Clear stale input when play stops or the game pauses. */
  reset(): void {
    this.shootTicks = 0
    this.throwTicks = 0
    this.passTicks = 0
    this.held.clear()
    this.prevHeld.clear()
    this.tapped.clear()
  }

  /** Sample once per simulation tick. */
  sample(basis: ScreenBasis): Command[] {
    this.prevHeld = this.held
    this.held = new Set<InputAction>()
    for (const code of this.keys) {
      const a = this.codeToAction.get(code)
      if (a) this.held.add(a)
    }
    const stick = this.pollGamepad(this.held)

    let sx = (this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0)
    let sy = (this.held.has('up') ? 1 : 0) - (this.held.has('down') ? 1 : 0)
    if (len(stick) > 0) {
      sx = stick.x
      sy = stick.y
    }
    const screen = clampLen({ x: sx, y: sy }, 1)
    const dir = screenToSimDirection(screen, basis)
    this.lastMove = dir

    if (this.throwMode) return this.sampleThrow(dir)

    const commands: Command[] = [
      { type: 'Move', dir, sprint: this.held.has('sprint'), sole: this.held.has('sole') },
    ]
    if (this.passCharge) this.sampleChargedPass(dir, commands)
    else {
      // Without the ball: the pass key tackles (or plays a one-touch pass) at once.
      if (this.pressed('pass')) commands.push({ type: 'Pass', dir, through: false })
      if (this.pressed('through')) commands.push({ type: 'Pass', dir, through: false, chip: true, power: 0 })
    }
    if (this.pressed('switch')) commands.push({ type: 'SwitchPlayer', dir })

    // Shooting: hold to charge, release to shoot; full charge fires automatically.
    if (this.held.has('shoot')) {
      // shootTicks < 0: the key is still held after a shot/throw; wait for release.
      if (this.shootTicks >= 0) {
        this.shootTicks++
        if (this.shootTicks * DT >= SHOT.maxChargeTime) {
          commands.push({ type: 'Shoot', dir, power: 1 })
          this.shootTicks = -1
        }
      }
    } else if (this.shootTicks > 0) {
      const power = clamp((this.shootTicks * DT) / SHOT.maxChargeTime, 0.3, 1)
      commands.push({ type: 'Shoot', dir: this.lastMove, power })
      this.shootTicks = 0
    } else {
      // A tap that was released before any sample saw it held is a quick shot.
      if (this.shootTicks === 0 && this.tapped.has('shoot')) commands.push({ type: 'Shoot', dir, power: 0.3 })
      this.shootTicks = 0
    }
    this.tapped.clear()
    return commands
  }

  /**
   * Charged passing: hold the pass key for a firmer ground pass, or the chip key (the old through-pass
   * key) for a higher, longer chip; release to play it, a full charge plays it at once. A quick tap
   * is the softest pass / the smallest chip (just over a leg).
   */
  private sampleChargedPass(dir: Vec2, commands: Command[]): void {
    const holdPass = this.held.has('pass')
    const holdChip = this.held.has('through')
    if (holdPass || holdChip) {
      if (this.passTicks < 0) return // still held after a full-power pass
      this.passTicks++
      this.passThrough = holdChip && !holdPass
      const full = this.passThrough ? CHIP.chargeTime : PASS.chargeTime
      if (this.passTicks * DT >= full) {
        commands.push({ type: 'Pass', dir, through: false, power: 1, chip: this.passThrough })
        this.passTicks = -1
      }
      return
    }
    if (this.passTicks > 0) {
      const full = this.passThrough ? CHIP.chargeTime : PASS.chargeTime
      // The first ticks of a press count as a tap (power 0).
      const power = clamp((this.passTicks * DT - 0.06) / (full - 0.06), 0, 1)
      commands.push({ type: 'Pass', dir, through: false, power, chip: this.passThrough })
    } else if (this.passTicks === 0 && (this.tapped.has('pass') || this.tapped.has('through'))) {
      commands.push({ type: 'Pass', dir, through: false, power: 0, chip: this.tapped.has('through') })
    }
    this.passTicks = 0
  }

  /** Keeper throw: hold pass/shoot/through to charge, aim with the direction keys, release to throw. */
  private sampleThrow(dir: Vec2): Command[] {
    const throwKeys: InputAction[] = ['pass', 'shoot', 'through']
    const holding = throwKeys.some((a) => this.held.has(a))
    const tapped = throwKeys.some((a) => this.tapped.has(a))
    const commands: Command[] = []
    if (holding) {
      this.throwTicks++
      commands.push({ type: 'Move', dir, sprint: false, sole: false, aimOnly: true })
      if (this.throwTicks * DT >= THROW.maxChargeTime) {
        commands.push({ type: 'Throw', dir, power: 1 })
        this.throwTicks = 0
      }
    } else {
      // Not charging: the keeper may walk with the ball in his hands inside his penalty area
      // (after a save and at goal clearances). While charging a throw the keys only aim.
      commands.push({ type: 'Move', dir, sprint: this.held.has('sprint'), sole: false })
      if (this.throwTicks > 0) {
        commands.push({
          type: 'Throw',
          dir,
          power: clamp((this.throwTicks * DT) / THROW.maxChargeTime, 0.2, 1),
        })
      } else if (tapped) {
        // A tap released before any sample saw it held: a soft throw.
        commands.push({ type: 'Throw', dir, power: 0.2 })
      }
      this.throwTicks = 0
    }
    if (this.pressed('switch')) commands.push({ type: 'SwitchPlayer', dir })
    this.tapped.clear()
    return commands
  }

  private pressed(a: InputAction): boolean {
    return (this.held.has(a) && !this.prevHeld.has(a)) || this.tapped.has(a)
  }

  private pollGamepad(held: Set<InputAction>): Vec2 {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []
    for (const pad of pads) {
      if (!pad) continue
      for (const [action, buttons] of Object.entries(DEFAULT_GAMEPAD) as [InputAction, number[]][]) {
        if (buttons.some((b) => pad.buttons[b]?.pressed)) held.add(action)
      }
      const x = pad.axes[0] ?? 0
      const y = -(pad.axes[1] ?? 0)
      const m = Math.hypot(x, y)
      if (m > GAMEPAD_DEADZONE) {
        const scaled = (m - GAMEPAD_DEADZONE) / (1 - GAMEPAD_DEADZONE)
        return { x: (x / m) * Math.min(1, scaled), y: (y / m) * Math.min(1, scaled) }
      }
      return { x: 0, y: 0 }
    }
    return { x: 0, y: 0 }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const action = this.codeToAction.get(e.code)
    if (!action) return
    // Leave keyboard navigation of menu form controls (settings selects, Camera Lab sliders) alone —
    // except the pause and Camera Lab keys, which must still close their panel when a control has
    // the focus.
    if (isFormControl(e.target) && action !== 'pause' && action !== 'cameraLab') return
    // Keep arrows/space from scrolling and F5 from reloading during play.
    e.preventDefault()
    if (
      !e.repeat &&
      (action === 'pause' ||
        action === 'camera' ||
        action === 'cameraLab' ||
        action === 'aiDebug' ||
        action === 'help')
    )
      this.uiPresses.push(action)
    if (!e.repeat) this.tapped.add(action)
    this.keys.add(e.code)
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code)
  }

  private onBlur = (): void => {
    this.keys.clear()
  }
}

function isFormControl(t: EventTarget | null): boolean {
  const tag = (t as { tagName?: string } | null)?.tagName
  return tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA'
}
