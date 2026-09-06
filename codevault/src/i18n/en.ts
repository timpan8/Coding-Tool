import type { StringKey } from './sv'

/** English fallback strings. May be partial; missing keys fall back to Swedish. */
export const en: Partial<Record<StringKey, string>> = {
  'app.title': 'CodeVault',
  'app.tagline': 'AI code in, real values stay here.',
  'app.desktopOnly': 'CodeVault is built for the desktop. The window is too narrow (at least 900 px needed).',
  'app.loading': 'Loading…',
  'app.networkRequests': 'Network requests this session: {count}',
}
