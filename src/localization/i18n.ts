import { en } from './en'
import { fi } from './fi'

export type Lang = 'en' | 'fi'
export type TranslationKey = keyof typeof en

export const DICTIONARIES: Record<Lang, Record<TranslationKey, string>> = { en, fi }

/** Translate a key, replacing {name} placeholders. Falls back to English, then to the key itself. */
export function translate(lang: Lang, key: TranslationKey, vars?: Record<string, string | number>): string {
  let s = DICTIONARIES[lang][key] ?? en[key] ?? key
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
  return s
}
