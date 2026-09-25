import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

describe('app metadata', () => {
  it('uses the same scalable mark in the header and favicon, with an ICO fallback', () => {
    const appPath = path.resolve(import.meta.dirname, '../App.vue')
    const indexPath = path.resolve(import.meta.dirname, '../../index.html')
    const svgPath = path.resolve(import.meta.dirname, '../../public/favicon.svg')
    const icoPath = path.resolve(import.meta.dirname, '../../public/favicon.ico')
    const pngPath = path.resolve(import.meta.dirname, '../../public/little-sips-logo.png')
    const app = readFileSync(appPath, 'utf8')
    const indexHtml = readFileSync(indexPath, 'utf8')
    const svg = readFileSync(svgPath, 'utf8')
    const ico = readFileSync(icoPath)
    const png = readFileSync(pngPath)

    expect(app).toContain('`${import.meta.env.BASE_URL}favicon.svg`')
    expect(app).toContain(':src="logoUrl"')
    expect(indexHtml).toContain('href="/favicon.svg" type="image/svg+xml"')
    expect(indexHtml).toContain('href="/favicon.ico" type="image/x-icon"')
    expect(svg).toContain('viewBox="0 0 64 64"')
    expect(svg).toContain('fill="#ef8376"')
    expect(svg).toContain('fill="#72b7a0"')
    expect(ico.readUInt16LE(2)).toBe(1)
    expect(ico.readUInt16LE(4)).toBe(3)
    expect([0, 1, 2].map((index) => ico.readUInt8(6 + index * 16))).toEqual([16, 32, 48])
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1024, 1024])
  })
})
