import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import memoryDriver from 'unstorage/drivers/memory'

import { readLegacyData, LEGACY_STORAGE_KEY } from '../migration'
import { loadData, _setTestDriver, GUEST_NAMESPACE, STORAGE_KEY } from '../storage'

describe('readLegacyData', () => {
  beforeEach(() => localStorage.clear())

  it('returns null when localStorage has no legacy key', () => {
    expect(readLegacyData()).toBeNull()
  })

  it('returns null for corrupt JSON', () => {
    expect(readLegacyData({ getItem: () => 'not-json' })).toBeNull()
  })

  it('returns null when feeds/weights are missing', () => {
    expect(readLegacyData({ getItem: () => JSON.stringify({ feeds: [] }) })).toBeNull()
  })

  it('parses valid legacy data and backfills updatedAt', () => {
    const legacy = {
      feeds: [{ id: 'f1', amount: 80, occurredAt: '2026-01-01T10:00:00.000Z', comment: '' }],
      weights: [{ id: 'w1', kilograms: 4.0, occurredAt: '2026-01-01T10:00:00.000Z' }],
    }
    const result = readLegacyData({ getItem: () => JSON.stringify(legacy) })
    expect(result).not.toBeNull()
    expect(result!.feeds[0]!.id).toBe('f1')
    expect(result!.feeds[0]!.updatedAt).toBe('2026-01-01T10:00:00.000Z')
    expect(result!.weights[0]!.updatedAt).toBe('2026-01-01T10:00:00.000Z')
  })

  it('LEGACY_STORAGE_KEY matches the old storage module key', () => {
    expect(LEGACY_STORAGE_KEY).toBe(STORAGE_KEY)
  })
})

describe('loadData legacy migration path', () => {
  beforeEach(() => {
    _setTestDriver(memoryDriver())
    localStorage.clear()
  })

  afterEach(() => {
    _setTestDriver(null)
    localStorage.clear()
  })

  it('migrates legacy data to IndexedDB on first load', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        feeds: [{ id: 'leg-1', amount: 60, occurredAt: '2026-01-01T08:00:00.000Z', comment: '' }],
        weights: [],
      }),
    )

    const result = await loadData(GUEST_NAMESPACE)
    expect(result.feeds[0]!.id).toBe('leg-1')
    expect(result.feeds[0]!.updatedAt).toBe('2026-01-01T08:00:00.000Z')
  })

  it('does not use legacy data for user namespaces', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        feeds: [{ id: 'leg-user', amount: 50, occurredAt: '2026-01-01T08:00:00.000Z', comment: '' }],
        weights: [],
      }),
    )

    const result = await loadData('user-some-uid')
    expect(result.feeds).toHaveLength(0)
  })

  it('returns empty data (not legacy) when localStorage is empty', async () => {
    const result = await loadData(GUEST_NAMESPACE)
    expect(result).toEqual({ feeds: [], weights: [] })
  })
})
