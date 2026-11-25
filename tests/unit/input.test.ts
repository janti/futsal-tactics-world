import { describe, expect, it } from 'vitest'
import { InputManager } from '../../src/input/InputManager'
import { basisForOrientation } from '../../src/camera/ScreenToWorld'

function key(target: EventTarget, type: 'keydown' | 'keyup', code: string) {
  target.dispatchEvent(Object.assign(new Event(type), { code, repeat: false }))
}

describe('input manager', () => {
  const basis = basisForOrientation(1)

  it('a tap that goes down and up between two samples is not lost', () => {
    const target = new EventTarget()
    const input = new InputManager(target as unknown as Window)
    key(target, 'keydown', 'KeyZ')
    key(target, 'keyup', 'KeyZ')
    const cmds = input.sample(basis)
    expect(cmds.filter((c) => c.type === 'Pass')).toHaveLength(1)
    // ...and it fires only once.
    expect(input.sample(basis).some((c) => c.type === 'Pass')).toBe(false)
  })

  it('a held key fires once, not every tick', () => {
    const target = new EventTarget()
    const input = new InputManager(target as unknown as Window)
    key(target, 'keydown', 'KeyV')
    let n = 0
    for (let i = 0; i < 10; i++) n += input.sample(basis).filter((c) => c.type === 'SwitchPlayer').length
    expect(n).toBe(1)
  })

  it('a very quick shoot tap still shoots (minimum power)', () => {
    const target = new EventTarget()
    const input = new InputManager(target as unknown as Window)
    key(target, 'keydown', 'KeyX')
    key(target, 'keyup', 'KeyX')
    const shot = input.sample(basis).find((c) => c.type === 'Shoot')
    expect(shot).toBeDefined()
    expect(input.sample(basis).some((c) => c.type === 'Shoot')).toBe(false)
  })

  it('holding shoot charges and releases one shot with more power', () => {
    const target = new EventTarget()
    const input = new InputManager(target as unknown as Window)
    key(target, 'keydown', 'KeyX')
    const shots = []
    for (let i = 0; i < 20; i++) shots.push(...input.sample(basis).filter((c) => c.type === 'Shoot'))
    key(target, 'keyup', 'KeyX')
    shots.push(...input.sample(basis).filter((c) => c.type === 'Shoot'))
    expect(shots).toHaveLength(1)
    const s = shots[0]!
    expect(s.type === 'Shoot' && s.power).toBeGreaterThan(0.4)
  })

  it('movement is screen-relative: "up" is the attacking direction at the top of the screen', () => {
    const target = new EventTarget()
    const input = new InputManager(target as unknown as Window)
    key(target, 'keydown', 'ArrowUp')
    const move = input.sample(basis).find((c) => c.type === 'Move')
    expect(move?.type === 'Move' && move.dir.y).toBeCloseTo(1)
  })
})

describe('input manager: keeper throw mode', () => {
  const basis = basisForOrientation(1)

  it('holding a throw key aims (no movement) and releasing throws with charged power', () => {
    const target = new EventTarget()
    const input = new InputManager(target as unknown as Window)
    input.setThrowMode(true)
    key(target, 'keydown', 'ArrowRight')
    key(target, 'keydown', 'KeyZ')
    const during = input.sample(basis)
    const move = during.find((c) => c.type === 'Move')
    expect(move?.type === 'Move' && move.aimOnly).toBe(true)
    expect(during.some((c) => c.type === 'Pass' || c.type === 'Throw')).toBe(false)
    for (let i = 0; i < 20; i++) input.sample(basis)
    expect(input.shotCharge).toBeGreaterThan(0.3)
    key(target, 'keyup', 'KeyZ')
    const release = input.sample(basis)
    const t = release.find((c) => c.type === 'Throw')
    expect(t?.type === 'Throw' && t.power).toBeGreaterThan(0.3)
    expect(t?.type === 'Throw' && t.dir.x).toBeLessThan(-0.9) // screen right = sim -x
  })

  it('direction keys alone walk the keeper with the ball in his hands; holding a throw key aims', () => {
    const target = new EventTarget()
    const input = new InputManager(target as unknown as Window)
    input.setThrowMode(true)
    key(target, 'keydown', 'ArrowLeft')
    key(target, 'keydown', 'ShiftLeft')
    const move = input.sample(basis).find((c) => c.type === 'Move')
    expect(move?.type === 'Move' && !move.aimOnly).toBe(true)
    expect(move?.type === 'Move' && move.sprint).toBe(true)
    expect(move?.type === 'Move' && move.dir.x).toBeGreaterThan(0.9) // screen left = sim +x
  })

  it('a quick tap is a soft throw; no pass or shot commands in throw mode', () => {
    const target = new EventTarget()
    const input = new InputManager(target as unknown as Window)
    input.setThrowMode(true)
    key(target, 'keydown', 'KeyX')
    key(target, 'keyup', 'KeyX')
    const cmds = input.sample(basis)
    const t = cmds.find((c) => c.type === 'Throw')
    expect(t?.type === 'Throw' && t.power).toBeCloseTo(0.2)
    expect(cmds.some((c) => c.type === 'Shoot' || c.type === 'Pass')).toBe(false)
  })

  it('a shoot key still held after the throw does not charge a shot for the receiver', () => {
    const target = new EventTarget()
    const input = new InputManager(target as unknown as Window)
    input.setThrowMode(true)
    key(target, 'keydown', 'KeyX')
    for (let i = 0; i < 5; i++) input.sample(basis)
    input.setThrowMode(false)
    for (let i = 0; i < 10; i++) expect(input.sample(basis).some((c) => c.type === 'Shoot')).toBe(false)
    key(target, 'keyup', 'KeyX')
    expect(input.sample(basis).some((c) => c.type === 'Shoot')).toBe(false)
  })
})

describe('input manager: full-power shot', () => {
  it('holding shoot past full charge fires exactly one shot until the key is released', () => {
    const target = new EventTarget()
    const input = new InputManager(target as unknown as Window)
    key(target, 'keydown', 'KeyX')
    let shots = 0
    for (let i = 0; i < 200; i++)
      shots += input.sample(basisForOrientation(1)).filter((c) => c.type === 'Shoot').length
    key(target, 'keyup', 'KeyX')
    shots += input.sample(basisForOrientation(1)).filter((c) => c.type === 'Shoot').length
    expect(shots).toBe(1)
  })
})
