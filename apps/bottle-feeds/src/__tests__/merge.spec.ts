import { describe, expect, it } from 'vite-plus/test'
import { mergeFeeds, mergeWeights, mergeAppData, mergeImport, unmergedGuestData } from '../merge'
import type { AppData, Feed, Weight } from '../types'

const makeFeed = (overrides: Partial<Feed> = {}): Feed => ({
  id: 'f1',
  amount: 100,
  occurredAt: '2026-01-01T12:00:00.000Z',
  comment: '',
  updatedAt: '2026-01-01T12:00:00.000Z',
  ...overrides,
})

const makeWeight = (overrides: Partial<Weight> = {}): Weight => ({
  id: 'w1',
  kilograms: 4.0,
  occurredAt: '2026-01-01T12:00:00.000Z',
  updatedAt: '2026-01-01T12:00:00.000Z',
  ...overrides,
})

describe('mergeFeeds', () => {
  it('combines disjoint sets', () => {
    const local = [makeFeed({ id: 'f1' })]
    const remote = [makeFeed({ id: 'f2' })]
    const result = mergeFeeds(local, remote)
    expect(result).toHaveLength(2)
  })

  it('remote wins on same ID when remote is newer', () => {
    const local = [makeFeed({ id: 'f1', amount: 100, updatedAt: '2026-01-01T10:00:00.000Z' })]
    const remote = [makeFeed({ id: 'f1', amount: 200, updatedAt: '2026-01-01T11:00:00.000Z' })]
    const result = mergeFeeds(local, remote)
    expect(result).toHaveLength(1)
    expect(result[0]!.amount).toBe(200)
  })

  it('local wins when local is newer', () => {
    const local = [makeFeed({ id: 'f1', amount: 300, updatedAt: '2026-01-01T12:00:00.000Z' })]
    const remote = [makeFeed({ id: 'f1', amount: 100, updatedAt: '2026-01-01T11:00:00.000Z' })]
    const result = mergeFeeds(local, remote)
    expect(result[0]!.amount).toBe(300)
  })

  it('compares update instants rather than timezone representation', () => {
    const local = [makeFeed({ amount: 300, updatedAt: '2026-01-01T10:00:00Z' })]
    const remote = [makeFeed({ amount: 100, updatedAt: '2026-01-01T11:00:00+02:00' })]
    expect(mergeFeeds(local, remote)[0]!.amount).toBe(300)
    expect(mergeFeeds(remote, local)[0]!.amount).toBe(300)
  })

  it('uses the incoming record on equal instants with different ISO formats', () => {
    const local = [makeFeed({ amount: 300, updatedAt: '2026-01-01T10:00:00Z' })]
    const remote = [makeFeed({ amount: 100, updatedAt: '2026-01-01T10:00:00.000Z' })]
    expect(mergeFeeds(local, remote)[0]!.amount).toBe(100)
  })

  it('tombstone propagation: keeps deleted records so other clients see them', () => {
    const local = [makeFeed({ id: 'f1', amount: 100 })]
    const remote = [
      makeFeed({ id: 'f1', amount: 100, deletedAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' }),
    ]
    const result = mergeFeeds(local, remote)
    // Tombstone is preserved in the raw merge result
    expect(result).toHaveLength(1)
    expect(result[0]!.deletedAt).toBeDefined()
  })

  it('is deterministic regardless of input order', () => {
    const a = makeFeed({ id: 'f1', amount: 100, updatedAt: '2026-01-01T10:00:00.000Z' })
    const b = makeFeed({ id: 'f1', amount: 200, updatedAt: '2026-01-01T11:00:00.000Z' })
    const r1 = mergeFeeds([a], [b])
    const r2 = mergeFeeds([b], [a])
    expect(r1[0]!.amount).toBe(r2[0]!.amount)
  })
})

describe('mergeWeights', () => {
  it('merges by ID with newest updatedAt winning', () => {
    const local = [makeWeight({ id: 'w1', kilograms: 4.0, updatedAt: '2026-01-01T10:00:00.000Z' })]
    const remote = [makeWeight({ id: 'w1', kilograms: 4.5, updatedAt: '2026-01-01T11:00:00.000Z' })]
    const result = mergeWeights(local, remote)
    expect(result[0]!.kilograms).toBe(4.5)
  })
})

describe('mergeAppData', () => {
  it('merges both feeds and weights', () => {
    const local = { feeds: [makeFeed({ id: 'f1' })], weights: [makeWeight({ id: 'w1' })] }
    const remote = { feeds: [makeFeed({ id: 'f2' })], weights: [makeWeight({ id: 'w2' })] }
    const result = mergeAppData(local, remote)
    expect(result.feeds).toHaveLength(2)
    expect(result.weights).toHaveLength(2)
  })
})

describe('unmergedGuestData', () => {
  it('does not offer records already in the family, including ones edited or deleted there', () => {
    const guest = { feeds: [makeFeed(), makeFeed({ id: 'new' })], weights: [makeWeight()] }
    const family = {
      feeds: [makeFeed({ amount: 120, updatedAt: '2026-01-02T12:00:00.000Z' })],
      weights: [makeWeight({ deletedAt: '2026-01-02T12:00:00.000Z', updatedAt: '2026-01-02T12:00:00.000Z' })],
    }
    expect(unmergedGuestData(guest, family)).toEqual({ feeds: [guest.feeds[1]], weights: [] })
    expect(guest.feeds).toHaveLength(2)
  })

  it('offers first-family data and guest edits made after an earlier merge', () => {
    const guest = { feeds: [makeFeed()], weights: [makeWeight()] }
    const family: AppData = { feeds: [], weights: [] }
    expect(unmergedGuestData(guest, family)).toEqual(guest)
    family.feeds.push(makeFeed({ amount: 80, updatedAt: '2025-12-31T12:00:00.000Z' }))
    family.weights.push(makeWeight())
    expect(unmergedGuestData(guest, family)).toEqual({ feeds: guest.feeds, weights: [] })
  })

  it('offers equal-timestamp guest changes that merge would choose over the family copy', () => {
    const guest = { feeds: [makeFeed({ amount: 120 })], weights: [] }
    const family = { feeds: [makeFeed()], weights: [] }
    expect(unmergedGuestData(guest, family)).toEqual(guest)
  })
})

describe('mergeImport', () => {
  it('rejects the entire import without mutating existing data when any row is invalid', () => {
    const existing = { feeds: [makeFeed()], weights: [] }
    const snapshot = structuredClone(existing)
    const imported = {
      feeds: [makeFeed({ id: 'valid' }), makeFeed({ id: 'invalid', occurredAt: 'not-a-date' })],
      weights: [],
    }
    expect(() => mergeImport(existing, imported)).toThrow('Invalid app data')
    expect(existing).toEqual(snapshot)
  })

  it('rejects duplicate imported IDs rather than silently choosing a row', () => {
    expect(() => mergeImport({ feeds: [], weights: [] }, {
      feeds: [makeFeed(), makeFeed({ amount: 200 })],
      weights: [],
    })).toThrow('duplicate record ID')
  })

  it('normalizes imported timestamps before resolving conflicts', () => {
    const existing = { feeds: [makeFeed({ updatedAt: '2026-01-01T10:00:00Z' })], weights: [] }
    const imported = { feeds: [makeFeed({ amount: 200, updatedAt: '2026-01-01T10:30:00+01:00' })], weights: [] }
    expect(mergeImport(existing, imported).feeds[0]!.amount).toBe(100)
  })
  it('backfills updatedAt from occurredAt for imported records without it', () => {
    const existing = { feeds: [], weights: [] }
    const imported = {
      feeds: [{ id: 'f1', amount: 100, occurredAt: '2026-01-01T12:00:00.000Z', comment: '' } as unknown as Feed],
      weights: [],
    }
    const result = mergeImport(existing, imported)
    expect(result.feeds[0]!.updatedAt).toBe('2026-01-01T12:00:00.000Z')
  })

  it('imported record wins over existing on ID conflict', () => {
    const existing = {
      feeds: [makeFeed({ id: 'f1', amount: 100, updatedAt: '2026-01-01T10:00:00.000Z' })],
      weights: [],
    }
    const imported = {
      feeds: [makeFeed({ id: 'f1', amount: 999, updatedAt: '2026-01-01T11:00:00.000Z' })],
      weights: [],
    }
    const result = mergeImport(existing, imported)
    expect(result.feeds[0]!.amount).toBe(999)
  })
})
