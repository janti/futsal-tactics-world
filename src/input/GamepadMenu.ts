/**
 * Gamepad support outside the match simulation: Start toggles the pause menu (it sends Escape, the
 * same as the keyboard), and while a menu is on screen (an element with `data-menu`) the D-pad /
 * left stick moves the focus, left/right changes a focused select, A activates and B goes back.
 * Runs on its own animation-frame loop so it also works while the game is paused or in the menus.
 */
const BTN_A = 0
const BTN_B = 1
const BTN_START = 9
const DPAD = { up: 12, down: 13, left: 14, right: 15 } as const
const STICK_THRESHOLD = 0.55
const REPEAT_FIRST = 0.38
const REPEAT_NEXT = 0.13

type Dir = 'up' | 'down' | 'left' | 'right' | null

function sendKey(code: string): void {
  for (const type of ['keydown', 'keyup'] as const)
    window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }))
}

function activeMenu(): HTMLElement | null {
  const menus = document.querySelectorAll<HTMLElement>('[data-menu]')
  return menus.length ? menus[menus.length - 1]! : null
}

function focusables(menu: HTMLElement): HTMLElement[] {
  return [
    ...menu.querySelectorAll<HTMLElement>(
      'button:not([disabled]), select:not([disabled]), input:not([disabled])',
    ),
  ].filter((el) => el.offsetParent !== null || el.getClientRects().length > 0)
}

function stepSelect(sel: HTMLSelectElement, delta: number): void {
  const i = Math.max(0, Math.min(sel.options.length - 1, sel.selectedIndex + delta))
  if (i === sel.selectedIndex) return
  // Use the native setter so React sees the change event.
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
  setter?.call(sel, sel.options[i]!.value)
  sel.dispatchEvent(new Event('change', { bubbles: true }))
}

export class GamepadMenu {
  private prev: boolean[] = []
  private heldDir: Dir = null
  private nextRepeat = 0
  private raf = 0

  start(): () => void {
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop)
      this.tick(now / 1000)
    }
    this.raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(this.raf)
  }

  tick(now: number): void {
    const pads = navigator.getGamepads ? navigator.getGamepads() : []
    const pad = [...pads].find((p) => p && p.connected)
    if (!pad) return
    const down = pad.buttons.map((b) => b.pressed)
    const prev = this.prev
    const edge = (i: number) => !!down[i] && !prev[i]
    this.prev = down

    if (edge(BTN_START)) sendKey('Escape')
    const menu = activeMenu()
    if (!menu) {
      this.heldDir = null
      return
    }
    const dir = this.readDir(pad, down)
    if (dir !== this.heldDir) {
      this.heldDir = dir
      this.nextRepeat = now + REPEAT_FIRST
      if (dir) this.move(menu, dir)
    } else if (dir && now >= this.nextRepeat) {
      this.nextRepeat = now + REPEAT_NEXT
      this.move(menu, dir)
    }
    if (edge(BTN_A)) {
      const el = document.activeElement as HTMLElement | null
      if (el && menu.contains(el)) el.click()
      else focusables(menu)[0]?.focus()
    }
    if (edge(BTN_B)) sendKey('Escape')
  }

  private readDir(pad: Gamepad, down: boolean[]): Dir {
    if (down[DPAD.up]) return 'up'
    if (down[DPAD.down]) return 'down'
    if (down[DPAD.left]) return 'left'
    if (down[DPAD.right]) return 'right'
    const x = pad.axes[0] ?? 0
    const y = pad.axes[1] ?? 0
    if (Math.max(Math.abs(x), Math.abs(y)) < STICK_THRESHOLD) return null
    if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'right' : 'left'
    return y > 0 ? 'down' : 'up'
  }

  private move(menu: HTMLElement, dir: Exclude<Dir, null>): void {
    const items = focusables(menu)
    if (!items.length) return
    const current = document.activeElement as HTMLElement | null
    const i = current ? items.indexOf(current) : -1
    if (i < 0) {
      items[0]!.focus()
      return
    }
    if ((dir === 'left' || dir === 'right') && current instanceof HTMLSelectElement) {
      stepSelect(current, dir === 'right' ? 1 : -1)
      return
    }
    const delta = dir === 'down' || dir === 'right' ? 1 : -1
    items[(i + delta + items.length) % items.length]!.focus()
  }
}
