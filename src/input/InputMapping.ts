/** Logical actions and their default bindings (KeyboardEvent.code, i.e. physical key positions). */
export type InputAction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'pass'
  | 'shoot'
  | 'through'
  | 'switch'
  | 'sprint'
  | 'sole'
  | 'pause'
  | 'camera'
  | 'cameraLab'
  | 'aiDebug'
  | 'help'

export const DEFAULT_KEYBOARD: Record<InputAction, string[]> = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  pass: ['KeyZ', 'KeyJ'],
  shoot: ['KeyX', 'KeyK'],
  through: ['KeyC', 'KeyL'],
  switch: ['KeyV', 'KeyI'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  sole: ['Space'],
  pause: ['Escape', 'KeyP'],
  // F5 normally reloads the page; Digit5 is the browser-safe alternative.
  camera: ['F5', 'Digit5'],
  cameraLab: ['Digit6'],
  aiDebug: ['Digit7'],
  help: ['KeyH'],
}

/** Standard Gamepad API button indices. */
export const DEFAULT_GAMEPAD: Partial<Record<InputAction, number[]>> = {
  pass: [0],
  shoot: [1],
  through: [2],
  switch: [3],
  sprint: [7],
  sole: [6],
  // Start (9) is handled by GamepadMenu, which also works while paused and in the menus.
  up: [12],
  down: [13],
  left: [14],
  right: [15],
}

export const GAMEPAD_DEADZONE = 0.2

export type KeyBindings = Record<InputAction, string[]>

/** Actions the player can rebind in the settings (UI actions keep their keys). */
export const REBINDABLE_ACTIONS: readonly InputAction[] = [
  'up',
  'down',
  'left',
  'right',
  'pass',
  'shoot',
  'through',
  'switch',
  'sprint',
  'sole',
]

/** Keys that cannot be bound to game actions (menus and browser keys). */
const RESERVED = new Set(['Escape', 'Enter', 'Tab', 'F5', 'KeyP', 'KeyH', 'Digit5', 'Digit6', 'Digit7'])

export function isBindableKey(code: string): boolean {
  return code.length > 0 && !RESERVED.has(code)
}

export function defaultBindings(): KeyBindings {
  const b = {} as KeyBindings
  for (const a of Object.keys(DEFAULT_KEYBOARD) as InputAction[]) b[a] = [...DEFAULT_KEYBOARD[a]]
  return b
}

/**
 * Bind `code` as the primary key of `action`: it replaces the action's first key (its other keys
 * stay) and is removed from every other action, so one key never does two things.
 */
export function rebind(bindings: KeyBindings, action: InputAction, code: string): KeyBindings {
  const next = {} as KeyBindings
  for (const a of Object.keys(bindings) as InputAction[]) next[a] = bindings[a].filter((c) => c !== code)
  next[action] = [code, ...next[action].slice(1).filter((c) => c !== code)]
  return next
}

/** Validate stored bindings; anything missing or malformed falls back to the default. */
export function sanitizeBindings(v: unknown): KeyBindings {
  const b = defaultBindings()
  if (!v || typeof v !== 'object') return b
  const o = v as Record<string, unknown>
  for (const a of REBINDABLE_ACTIONS) {
    const keys = o[a]
    if (
      Array.isArray(keys) &&
      keys.length > 0 &&
      keys.every((k) => typeof k === 'string' && isBindableKey(k))
    )
      b[a] = [...(keys as string[])]
  }
  return b
}

/** Short human-readable label for a KeyboardEvent.code. */
export function keyLabel(code: string): string {
  const named: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    ShiftLeft: 'Shift',
    ShiftRight: 'R-Shift',
    ControlLeft: 'Ctrl',
    ControlRight: 'R-Ctrl',
    AltLeft: 'Alt',
    AltRight: 'AltGr',
    Space: 'Space',
    Escape: 'Esc',
  }
  if (named[code]) return named[code]
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6)
  return code
}
