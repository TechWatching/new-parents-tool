import { describe, expect, it } from 'vite-plus/test'
import { addMissingMetadata, isValidAppData, parseAppData } from '../validation'

const feed = {
  id: 'legacy-f1',
  amount: 120,
  occurredAt: '2026-01-01T12:00:00.000Z',
  updatedAt: '2026-01-01T12:00:00.000Z',
  comment: '',
}
const weight = {
  id: 'legacy-w1',
  kilograms: 4,
  occurredAt: feed.occurredAt,
  updatedAt: feed.updatedAt,
}

describe('parseAppData', () => {
  it('accepts form boundaries and legacy non-UUID IDs', () => {
    expect(parseAppData({
      feeds: [{ ...feed, amount: 1 }, { ...feed, id: 'f2', amount: 2000, comment: 'a'.repeat(160) }],
      weights: [{ ...weight, kilograms: 0.1 }, { ...weight, id: 'w2', kilograms: 50 }],
    }).feeds).toHaveLength(2)
  })

  it('normalizes valid timestamps and fills only missing legacy metadata', () => {
    const value = {
      feeds: [{ id: 'f1', amount: 120, occurredAt: '2026-01-01T13:00:00+01:00' }],
      weights: [{ id: 'w1', kilograms: 4, occurredAt: '2026-01-01T07:00:00-05:00' }],
    }
    const parsed = parseAppData(value)
    expect(parsed.feeds[0]).toEqual({ ...feed, id: 'f1' })
    expect(parsed.weights[0]).toEqual({ ...weight, id: 'w1' })
    expect(addMissingMetadata(value)).toEqual(parsed)
    expect(value.feeds[0]).not.toHaveProperty('updatedAt')
  })

  it('normalizes tombstones and allows the same ID across record kinds', () => {
    const result = parseAppData({
      feeds: [{ ...feed, deletedAt: '2026-01-02T13:00:00+01:00' }],
      weights: [{ ...weight, id: feed.id }],
    })
    expect(result.feeds[0]!.deletedAt).toBe('2026-01-02T12:00:00.000Z')
    expect(result.weights[0]!.id).toBe(feed.id)
  })

  it.each([
    null, 1, 'data', [], {}, { feeds: [] }, { weights: [] },
    { feeds: {}, weights: [] }, { feeds: [], weights: {} },
    { feeds: [null], weights: [] }, { feeds: [], weights: ['not-a-record'] },
    { feeds: [feed, feed], weights: [] }, { feeds: [], weights: [weight, weight] },
  ])('rejects malformed payloads and duplicate IDs: %j', (value) => {
    expect(() => parseAppData(value)).toThrow('Invalid app data')
    expect(isValidAppData(value)).toBe(false)
  })

  it.each([
    ['id', ''], ['id', '  '], ['id', 42],
    ['amount', 0], ['amount', -1], ['amount', 2001], ['amount', 1.5],
    ['amount', NaN], ['amount', Infinity], ['amount', '120'], ['amount', null],
    ['comment', null], ['comment', {}], ['comment', 'a'.repeat(161)],
    ['occurredAt', 'invalid'], ['occurredAt', '2026-02-30T12:00:00Z'],
    ['occurredAt', '2025-02-29T12:00:00Z'], ['occurredAt', '2026-01-01T24:00:00Z'],
    ['occurredAt', '2026-01-01'], ['occurredAt', '2026-01-01T12:00:00'],
    ['occurredAt', 0], ['occurredAt', null], ['occurredAt', undefined],
    ['updatedAt', ''], ['updatedAt', null], ['updatedAt', 'invalid'],
    ['deletedAt', null], ['deletedAt', 'invalid'],
  ])('rejects invalid feed %s = %j', (field, value) => {
    const data = { feeds: [{ ...feed, [field as string]: value }], weights: [] }
    expect(() => parseAppData(data)).toThrow('Invalid app data')
    expect(isValidAppData(data)).toBe(false)
  })

  it.each([0, -1, 0.09, 50.1, NaN, Infinity, '4', null, undefined])(
    'rejects invalid weight %j', (kilograms) => {
      const data = { feeds: [], weights: [{ ...weight, kilograms }] }
      expect(() => parseAppData(data)).toThrow('Invalid app data')
      expect(isValidAppData(data)).toBe(false)
    },
  )

  it('accepts leap days that actually exist', () => {
    const data = { feeds: [{ ...feed, occurredAt: '2024-02-29T12:00:00Z' }], weights: [] }
    expect(parseAppData(data).feeds[0]!.occurredAt).toBe('2024-02-29T12:00:00.000Z')
  })

  it('rejects sparse arrays instead of leaving unvalidated holes', () => {
    const data: { feeds: unknown[]; weights: unknown[] } = { feeds: [], weights: [] }
    data.feeds.length = 1
    expect(() => parseAppData(data)).toThrow('expected a record')
  })
})
