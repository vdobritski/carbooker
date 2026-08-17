import { useEffect, useState } from 'react'
import {
  apply,
  readPreference,
  savePreference,
  watchSystem,
} from '../lib/theme'
import type { ThemePreference } from '../lib/theme'

const ORDER: ThemePreference[] = ['light', 'dark', 'system']
const LABEL: Record<ThemePreference, string> = {
  light: '☀ Light',
  dark: '☾ Dark',
  system: '☍ System',
}

/**
 * One button that cycles light → dark → system. A three-way select would take more room in
 * the navbar than the choice is worth, and the label always says which one is on.
 */
export default function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>(() => readPreference())

  useEffect(() => {
    apply(preference)
    if (preference !== 'system') return
    return watchSystem(() => apply('system'))
  }, [preference])

  function next() {
    const at = ORDER.indexOf(preference)
    const chosen = ORDER[(at + 1) % ORDER.length]
    savePreference(chosen)
    setPreference(chosen)
  }

  return (
    <button type="button" className="link theme-toggle" onClick={next} title="Change theme">
      {LABEL[preference]}
    </button>
  )
}
