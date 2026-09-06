/**
 * Swedish UI strings (default locale). Keys are stable identifiers; the
 * English table in en.ts is a fallback that may be partial.
 *
 * Anything the AI reads (example values, preambles, generated code comments)
 * is NOT in this table on purpose: that text is always English and lives in
 * the engine.
 */
export const sv = {
  'app.title': 'CodeVault',
  'app.tagline': 'AI-kod in, riktiga värden stannar här.',
  'app.desktopOnly':
    'CodeVault är byggt för skrivbordet. Fönstret är för smalt (minst 900 px behövs).',
  'app.loading': 'Laddar…',
  'app.networkRequests': 'Nätverksanrop denna session: {count}',
} as const

export type StringKey = keyof typeof sv
