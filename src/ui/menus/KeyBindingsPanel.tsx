import { useEffect, useState } from 'react'
import { REBINDABLE_ACTIONS, isBindableKey, keyLabel, type InputAction } from '../../input/InputMapping'
import type { TranslationKey } from '../../localization/i18n'
import { useUi } from '../store'
import { useT } from '../useT'

/** Keyboard controls: click an action, then press the new key (Esc cancels). Persisted. */
export function KeyBindingsPanel() {
  const t = useT()
  const bindings = useUi((s) => s.keyBindings)
  const setKeyBinding = useUi((s) => s.setKeyBinding)
  const reset = useUi((s) => s.resetKeyBindings)
  const [waiting, setWaiting] = useState<InputAction | null>(null)

  useEffect(() => {
    if (!waiting) return
    // Capture phase on window: runs before the game input and menu handlers, which never see it.
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.code !== 'Escape' && isBindableKey(e.code)) setKeyBinding(waiting, e.code)
      setWaiting(null)
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [waiting, setKeyBinding])

  return (
    <details className="keys-panel" data-testid="keys-panel">
      <summary>{t('settings.keys')}</summary>
      <table>
        <tbody>
          {REBINDABLE_ACTIONS.map((a) => (
            <tr key={a}>
              <td>{t(`keys.${a}` as TranslationKey)}</td>
              <td>
                <button
                  data-testid={`bind-${a}`}
                  className={waiting === a ? 'active' : ''}
                  onClick={() => setWaiting(waiting === a ? null : a)}
                >
                  {waiting === a ? t('settings.keys.press') : bindings[a].map(keyLabel).join(' / ')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button data-testid="keys-reset" onClick={reset}>
        {t('settings.keys.reset')}
      </button>
    </details>
  )
}
