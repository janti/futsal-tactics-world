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
  pause: [9],
  up: [12],
  down: [13],
  left: [14],
  right: [15],
}

export const GAMEPAD_DEADZONE = 0.2
