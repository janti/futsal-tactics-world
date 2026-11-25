import { describe, expect, it } from 'vitest'
import { defaultBindings, keyLabel, rebind, sanitizeBindings } from '../../src/input/InputMapping'
import { InputManager } from '../../src/input/InputManager'
import { basisForOrientation } from '../../src/camera/ScreenToWorld'

function key(target: EventTarget, type: 'keydown' | 'keyup', code: string) {
  target.dispatchEvent(Object.assign(new Event(type), { code, repeat: false }))
}

describe('key bindings', () => {
  it('rebinding replaces the primary key and removes it from other actions', () => {
    const b = rebind(defaultBindings(), 'pass', 'KeyX') // X was shoot
    expect(b.pass[0]).toBe('KeyX')
    expect(b.pass).toContain('KeyJ') // secondary key kept
    expect(b.shoot).not.toContain('KeyX')
  })

  it('stored bindings are validated; reserved keys and junk fall back to defaults', () => {
    const b = sanitizeBindings({ pass: ['KeyQ'], shoot: ['Escape'], through: 'x', up: [] })
    expect(b.pass).toEqual(['KeyQ'])
    expect(b.shoot).toEqual(defaultBindings().shoot)
    expect(b.through).toEqual(defaultBindings().through)
    expect(b.up).toEqual(defaultBindings().up)
    expect(sanitizeBindings(null)).toEqual(defaultBindings())
  })

  it('labels', () => {
    expect(keyLabel('KeyZ')).toBe('Z')
    expect(keyLabel('ArrowUp')).toBe('↑')
    expect(keyLabel('Digit7')).toBe('7')
  })

  it('the input manager uses rebound keys immediately', () => {
    const target = new EventTarget()
    const input = new InputManager(target as unknown as Window)
    const basis = basisForOrientation(1)
    input.setBindings(rebind(defaultBindings(), 'pass', 'KeyQ'))
    key(target, 'keydown', 'KeyQ')
    expect(input.sample(basis).some((c) => c.type === 'Pass')).toBe(true)
    key(target, 'keyup', 'KeyQ')
    key(target, 'keydown', 'KeyZ') // no longer bound
    expect(input.sample(basis).some((c) => c.type === 'Pass')).toBe(false)
  })
})
