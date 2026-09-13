import { describe, expect, it } from 'vite-plus/test'
import { conflictsAffectReport, createDefaultReportConfig, type ReportConflict } from '../report/logic'
import type { Feed, Weight } from '../types'

const now = new Date('2026-09-10T12:00:00Z')
const feed: Feed = { id: 'a', occurredAt: '2026-09-10T10:00:00Z', updatedAt: now.toISOString(), amount: 100, comment: 'Slowly' }
const weight: Weight = { id: 'b', occurredAt: '2026-09-10T00:00:00Z', updatedAt: now.toISOString(), kilograms: 4 }
const config = createDefaultReportConfig(now)
const conflict = (remote: Feed): ReportConflict => ({ kind: 'feed', local: feed, remote: { kind: 'feed', record: remote, version: '2' } })

describe('report conflict relevance', () => {
  it('blocks a changed amount that affects totals', () => {
    expect(conflictsAffectReport([conflict({ ...feed, amount: 120 })], config, now)).toBe(true)
  })
  it('blocks deletion and records moved out of the selected dates', () => {
    expect(conflictsAffectReport([conflict({ ...feed, deletedAt: now.toISOString() })], config, now)).toBe(true)
    expect(conflictsAffectReport([conflict({ ...feed, occurredAt: '2026-01-01T10:00:00Z' })], config, now)).toBe(true)
  })
  it('does not block unselected categories', () => {
    expect(conflictsAffectReport([conflict({ ...feed, amount: 120 })], { ...config, includeFeeds: false }, now)).toBe(false)
  })
  it('ignores timestamps used only for synchronization', () => {
    expect(conflictsAffectReport([conflict({ ...feed, updatedAt: '2026-09-10T11:00:00Z' })], config, now)).toBe(false)
  })
  it('blocks comment differences only when comments are included', () => {
    const changes = [conflict({ ...feed, comment: 'Quickly' })]
    expect(conflictsAffectReport(changes, config, now)).toBe(true)
    expect(conflictsAffectReport(changes, { ...config, includeComments: false }, now)).toBe(false)
  })
  it('does not block when both alternatives are outside the report', () => {
    const old = { ...feed, occurredAt: '2026-01-01T10:00:00Z' }
    expect(conflictsAffectReport([{ ...conflict({ ...old, amount: 120 }), local: old }], config, now)).toBe(false)
  })
  it('blocks weight conflicts affecting the selected latest weight', () => {
    const changes: ReportConflict[] = [{ kind: 'weight', local: weight, remote: { kind: 'weight', record: { ...weight, kilograms: 4.5 }, version: '2' } }]
    expect(conflictsAffectReport(changes, config, now)).toBe(true)
    expect(conflictsAffectReport(changes, { ...config, includeWeights: false }, now)).toBe(false)
  })
  it('does not block two deleted alternatives', () => {
    const deleted = { ...feed, deletedAt: now.toISOString() }
    expect(conflictsAffectReport([{ ...conflict(deleted), local: deleted }], config, now)).toBe(false)
  })
})
