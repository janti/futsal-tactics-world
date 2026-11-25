import { useCallback } from 'react'
import { DICTIONARIES, translate, type TranslationKey } from '../localization/i18n'
import { useUi } from './store'

/** Translation hook. Variable values that are themselves translation keys are translated too. */
export function useT() {
  const lang = useUi((s) => s.lang)
  return useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => {
      const resolved = vars
        ? Object.fromEntries(
            Object.entries(vars).map(([k, v]) => [
              k,
              typeof v === 'string' && v in DICTIONARIES.en ? translate(lang, v as TranslationKey) : v,
            ]),
          )
        : undefined
      return translate(lang, key, resolved)
    },
    [lang],
  )
}
