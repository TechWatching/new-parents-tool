import { describe, expect, it } from 'vite-plus/test'

const sources = import.meta.glob<string>(
  ['../**/*.ts', '../**/*.vue', '!../__tests__/**', '!../**/*.d.ts'],
  { query: '?raw', import: 'default', eager: true },
)

describe('provider-independent application boundary', () => {
  it('confines the Supabase SDK to its production adapter', () => {
    const violations = Object.entries(sources)
      .filter(([path]) => !path.startsWith('../backends/supabase/'))
      .filter(([, source]) => /(?:from\s*|import\s*\()\s*['"]@supabase\//.test(source))
      .map(([path]) => path)
    expect(violations).toEqual([])
  })

  it('keeps provider configuration at the composition boundary', () => {
    const violations = Object.entries(sources)
      .filter(([path]) => !path.startsWith('../backends/'))
      .filter(([, source]) => /\bVITE_SUPABASE_/.test(source))
      .map(([path]) => path)
    expect(violations).toEqual([])
  })

  it('does not couple application code directly to the production adapter', () => {
    const violations = Object.entries(sources)
      .filter(([path]) => !path.startsWith('../backends/'))
      .filter(([, source]) => /(?:from\s*|import\s*\()\s*['"][^'"]*backends\/supabase(?:\/|['"])/.test(source))
      .map(([path]) => path)
    expect(violations).toEqual([])
  })
})
