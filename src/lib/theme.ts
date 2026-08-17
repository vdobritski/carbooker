/**
 * Light or dark, chosen by the person rather than by their operating system.
 *
 * The stylesheet has exactly two palettes and no `prefers-color-scheme` query: this module
 * resolves "system" to one of them and stamps `data-theme` on <html>, so the CSS never has
 * to state the dark values twice. Nothing renders before the bundle runs, so there is no
 * flash to guard against.
 */

export type ThemePreference = 'light' | 'dark' | 'system'
export type Theme = 'light' | 'dark'

const KEY = 'carbooker.theme'

const dark = () => window.matchMedia('(prefers-color-scheme: dark)')

export function readPreference(): ThemePreference {
  const stored = localStorage.getItem(KEY)
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'light'
}

export function resolve(preference: ThemePreference): Theme {
  if (preference !== 'system') return preference
  return dark().matches ? 'dark' : 'light'
}

export function apply(preference: ThemePreference): Theme {
  const theme = resolve(preference)
  document.documentElement.dataset.theme = theme
  // Native controls - the date and time pickers the plan and trip forms lean on - follow
  // this rather than data-theme, and look wrong against the opposite background.
  document.documentElement.style.colorScheme = theme
  return theme
}

export function savePreference(preference: ThemePreference): Theme {
  localStorage.setItem(KEY, preference)
  return apply(preference)
}

/**
 * Follow the system while the preference is "system". Returns the unsubscribe.
 */
export function watchSystem(onChange: () => void): () => void {
  const query = dark()
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
