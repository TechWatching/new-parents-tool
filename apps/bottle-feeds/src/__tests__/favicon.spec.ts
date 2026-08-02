import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

describe('app metadata', () => {
  it('uses the branded svg favicon in the app shell', () => {
    const indexPath = path.resolve(import.meta.dirname, '../../index.html')
    const indexHtml = readFileSync(indexPath, 'utf8')

    expect(indexHtml).toContain('rel="icon"')
    expect(indexHtml).toContain('href="/favicon.svg"')
    expect(indexHtml).toContain('type="image/svg+xml"')
  })
})
