import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { createStorage } from 'unstorage'
import memoryDriver from 'unstorage/drivers/memory'

import {
  loadData,
  saveData,
  saveDataStrict,
  mergeDataStrict,
  finishSync,
  moveDataToGuest,
  clearData,
  markDirty,
  clearDirty,
  isDirty,
  GUEST_NAMESPACE,
  DATA_KEY,
  _setTestDriver,
  isValidAppData,
  addMissingMetadata,
} from '../storage'
import type { AppData } from '../types'

const makeData = (id = 'f1', amount = 120, updatedAt = '2026-01-01T12:00:00.000Z'): AppData => ({
  feeds: [{ id, amount, occurredAt: '2026-01-01T12:00:00.000Z', updatedAt, comment: '' }],
  weights: [],
})

describe('storage validation helpers', () => {
  it('accepts valid AppData', () => {
    expect(isValidAppData({ feeds: [], weights: [] })).toBe(true)
  })

  it('rejects null, primitives, and missing arrays', () => {
    expect(isValidAppData(null)).toBe(false)
    expect(isValidAppData('not-json')).toBe(false)
    expect(isValidAppData({ feeds: [] })).toBe(false)
    expect(isValidAppData({ weights: [] })).toBe(false)
  })

  it('backfills updatedAt from occurredAt when missing', () => {
    const raw: AppData = {
      feeds: [{ id: 'f1', amount: 100, occurredAt: '2026-01-01T00:00:00.000Z', comment: '', updatedAt: '' }],
      weights: [{ id: 'w1', kilograms: 4, occurredAt: '2026-01-02T00:00:00.000Z', updatedAt: '' }],
    }
    // Remove updatedAt to simulate legacy data
    const legacy = {
      feeds: [{ id: 'f1', amount: 100, occurredAt: '2026-01-01T00:00:00.000Z', comment: '' }],
      weights: [{ id: 'w1', kilograms: 4, occurredAt: '2026-01-02T00:00:00.000Z' }],
    }
    const result = addMissingMetadata(legacy as AppData)
    expect(result.feeds[0]!.updatedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(result.weights[0]!.updatedAt).toBe('2026-01-02T00:00:00.000Z')
    void raw
  })
})

describe('async IndexedDB-backed storage (memory driver)', () => {
  let driver: ReturnType<typeof memoryDriver>

  beforeEach(() => {
    driver = memoryDriver()
    _setTestDriver(driver)
  })

  afterEach(() => {
    _setTestDriver(null)
  })

  it('returns empty collections when there is no stored data', async () => {
    const result = await loadData(GUEST_NAMESPACE)
    expect(result).toEqual({ feeds: [], weights: [] })
  })

  it('saves and reloads data', async () => {
    const data: AppData = {
      feeds: [{ id: 'f1', amount: 120, occurredAt: '2026-01-01T12:00:00.000Z', comment: 'test', updatedAt: '2026-01-01T12:00:00.000Z' }],
      weights: [],
    }
    await saveData(data, GUEST_NAMESPACE)
    const loaded = await loadData(GUEST_NAMESPACE)
    expect(loaded.feeds[0]!.amount).toBe(120)
    expect(loaded.feeds[0]!.comment).toBe('test')
  })

  it.each([
    'not-json',
    '{"feeds":',
    'null',
    '{}',
    JSON.stringify({ feeds: [null], weights: [] }),
    JSON.stringify({ feeds: [{ ...makeData().feeds[0], occurredAt: 'invalid' }], weights: [] }),
    JSON.stringify({ feeds: [{ ...makeData().feeds[0], amount: -120 }], weights: [] }),
  ])('rejects actual corrupt stored data: %s', async (stored) => {
    const storage = createStorage({ driver })
    await storage.setItem(`${GUEST_NAMESPACE}:${DATA_KEY}`, stored)
    await expect(loadData()).rejects.toThrow(Error)
    await expect(mergeDataStrict(makeData('new'), GUEST_NAMESPACE, true)).rejects.toThrow(Error)
    expect(await storage.getItem(`${GUEST_NAMESPACE}:${DATA_KEY}`)).not.toEqual(makeData('new'))
    expect(await isDirty(GUEST_NAMESPACE)).toBe(false)
  })

  it('loads legacy metadata from both object and JSON-string driver values', async () => {
    const legacy = { feeds: [{ id: 'f1', amount: 120, occurredAt: '2026-01-01T13:00:00+01:00' }], weights: [] }
    driver.getInstance!().set('guest:data', legacy)
    expect(await loadData()).toEqual(makeData())
    driver.getInstance!().set('guest:data', JSON.stringify(legacy))
    expect(await loadData()).toEqual(makeData())
  })

  it('propagates read failures rather than treating them as missing data', async () => {
    await saveData(makeData())
    const failure = new Error('IndexedDB read unavailable')
    _setTestDriver({ ...driver, getItem: () => { throw failure } })
    await expect(loadData()).rejects.toBe(failure)
    await expect(isDirty(GUEST_NAMESPACE)).rejects.toBe(failure)
    await expect(mergeDataStrict(makeData('new'), GUEST_NAMESPACE)).rejects.toBe(failure)
    await expect(finishSync(makeData(), GUEST_NAMESPACE)).rejects.toBe(failure)
  })

  it('propagates quota errors from both replacement APIs and dirty marking', async () => {
    const failure = new DOMException('Storage full', 'QuotaExceededError')
    _setTestDriver({ ...driver, setItem: () => { throw failure } })
    await expect(saveData(makeData())).rejects.toBe(failure)
    await expect(saveDataStrict(makeData())).rejects.toBe(failure)
    await expect(markDirty(GUEST_NAMESPACE)).rejects.toBe(failure)
    await expect(mergeDataStrict(makeData(), GUEST_NAMESPACE, true)).rejects.toBe(failure)
    expect(await loadData()).toEqual({ feeds: [], weights: [] })
  })

  it('propagates removal failures', async () => {
    await saveData(makeData())
    await markDirty(GUEST_NAMESPACE)
    const failure = new Error('IndexedDB delete unavailable')
    _setTestDriver({ ...driver, removeItem: () => { throw failure } })
    await expect(clearData(GUEST_NAMESPACE)).rejects.toBe(failure)
    await expect(clearDirty(GUEST_NAMESPACE)).rejects.toBe(failure)
    await expect(finishSync(makeData(), GUEST_NAMESPACE)).rejects.toBe(failure)
    expect(await isDirty(GUEST_NAMESPACE)).toBe(true)
  })

  it('never substitutes memory when IndexedDB is unavailable', async () => {
    _setTestDriver(null)
    await expect(loadData()).rejects.toThrow('indexedDB is not defined')
    await expect(saveData(makeData())).rejects.toThrow('indexedDB is not defined')
  })

  it('keeps saveData and saveDataStrict as exact replacement operations', async () => {
    await saveData(makeData('first'))
    await saveDataStrict(makeData('second'))
    expect(await loadData()).toEqual(makeData('second'))
    await saveData({ feeds: [], weights: [] })
    expect(await loadData()).toEqual({ feeds: [], weights: [] })
  })

  it('rejects invalid replacements before modifying saved records', async () => {
    await saveData(makeData())
    await expect(saveData(makeData('bad', 0))).rejects.toThrow('quantity is out of range')
    await expect(mergeDataStrict(makeData('bad', 2001), GUEST_NAMESPACE, true)).rejects.toThrow('quantity is out of range')
    expect(await loadData()).toEqual(makeData())
    expect(await isDirty(GUEST_NAMESPACE)).toBe(false)
  })

  it('serializes concurrent read-modify-write merges without losing rows', async () => {
    const datasets = Array.from({ length: 20 }, (_, index) => makeData(`f${index}`))
    await Promise.all(datasets.map((data) => mergeDataStrict(data, GUEST_NAMESPACE, true)))
    const stored = await loadData()
    expect(stored.feeds.map((row) => row.id).sort()).toEqual(
      datasets.flatMap((data) => data.feeds.map((row) => row.id)).sort(),
    )
    expect(await isDirty(GUEST_NAMESPACE)).toBe(true)
  })

  it('preserves a newer persisted edit when a stale tab merges', async () => {
    await saveData(makeData('f1', 100, '2026-01-01T14:00:00.000Z'))
    const stale = makeData('f1', 90, '2026-01-01T13:00:00.000Z')
    stale.feeds.push(...makeData('f2').feeds)
    const data = await mergeDataStrict(stale, GUEST_NAMESPACE, true)
    expect(data.feeds.map(({ id, amount }) => ({ id, amount }))).toEqual([
      { id: 'f1', amount: 100 }, { id: 'f2', amount: 120 },
    ])
    expect(await loadData()).toEqual(data)
  })

  it('preserves an existing dirty flag when a merge does not mark dirty', async () => {
    await markDirty(GUEST_NAMESPACE)
    await mergeDataStrict(makeData(), GUEST_NAMESPACE)
    expect(await isDirty(GUEST_NAMESPACE)).toBe(true)
  })

  it('clears dirty only when the latest data equals the acknowledged snapshot', async () => {
    const synced = await mergeDataStrict(makeData(), GUEST_NAMESPACE, true)
    expect(await finishSync(synced, GUEST_NAMESPACE)).toEqual({ data: synced, pending: false })
    expect(await isDirty(GUEST_NAMESPACE)).toBe(false)
  })

  it('compares synced records by value and ID, independently of array order', async () => {
    const synced = await mergeDataStrict({
      feeds: [...makeData('f1').feeds, ...makeData('f2').feeds],
      weights: [
        { id: 'w1', kilograms: 4, occurredAt: '2026-01-01T12:00:00.000Z', updatedAt: '2026-01-01T12:00:00.000Z' },
        { id: 'w2', kilograms: 5, occurredAt: '2026-01-01T12:00:00.000Z', updatedAt: '2026-01-01T12:00:00.000Z' },
      ],
    }, GUEST_NAMESPACE, true)
    const reversed = { feeds: [...synced.feeds].reverse(), weights: [...synced.weights].reverse() }
    expect(await finishSync(reversed, GUEST_NAMESPACE)).toEqual({ data: synced, pending: false })
    expect(await isDirty(GUEST_NAMESPACE)).toBe(false)
  })

  it('keeps an edit made during sync pending and returns the latest data', async () => {
    const synced = await mergeDataStrict(makeData(), GUEST_NAMESPACE, true)
    const newer = makeData('f1', 150, '2026-01-01T15:00:00.000Z')
    const [data, finished] = await Promise.all([
      mergeDataStrict(newer, GUEST_NAMESPACE, true),
      finishSync(synced, GUEST_NAMESPACE),
    ])
    expect(finished).toEqual({ data, pending: true })
    expect(await isDirty(GUEST_NAMESPACE)).toBe(true)
    expect(await loadData()).toEqual(newer)
    expect((await finishSync(newer, GUEST_NAMESPACE)).pending).toBe(false)
  })

  it('detects changed values even if a record timestamp did not change', async () => {
    const synced = await mergeDataStrict(makeData(), GUEST_NAMESPACE, true)
    await mergeDataStrict(makeData('f1', 160), GUEST_NAMESPACE, true)
    expect((await finishSync(synced, GUEST_NAMESPACE)).pending).toBe(true)
    expect(await isDirty(GUEST_NAMESPACE)).toBe(true)
  })

  it('keeps writes queued after sync finalization dirty', async () => {
    const synced = await mergeDataStrict(makeData(), GUEST_NAMESPACE, true)
    await Promise.all([
      finishSync(synced, GUEST_NAMESPACE),
      mergeDataStrict(makeData('f2'), GUEST_NAMESPACE, true),
    ])
    expect((await loadData()).feeds).toHaveLength(2)
    expect(await isDirty(GUEST_NAMESPACE)).toBe(true)
  })

  it('does not clear dirty when a row becomes a tombstone during sync', async () => {
    const synced = await mergeDataStrict(makeData(), GUEST_NAMESPACE, true)
    const deleted = makeData('f1', 120, '2026-01-02T12:00:00.000Z')
    deleted.feeds[0]!.deletedAt = '2026-01-02T12:00:00.000Z'
    await mergeDataStrict(deleted, GUEST_NAMESPACE, true)
    expect(await finishSync(synced, GUEST_NAMESPACE)).toEqual({ data: deleted, pending: true })
    expect(await isDirty(GUEST_NAMESPACE)).toBe(true)
  })

  it('isolates guest and user namespaces', async () => {
    const guestData: AppData = {
      feeds: [{ id: 'guest-feed', amount: 100, occurredAt: '2026-01-01T00:00:00.000Z', comment: '', updatedAt: '2026-01-01T00:00:00.000Z' }],
      weights: [],
    }
    const userData: AppData = {
      feeds: [{ id: 'user-feed', amount: 200, occurredAt: '2026-01-02T00:00:00.000Z', comment: '', updatedAt: '2026-01-02T00:00:00.000Z' }],
      weights: [],
    }

    await saveData(guestData, GUEST_NAMESPACE)
    await saveData(userData, 'user-abc123')

    const loadedGuest = await loadData(GUEST_NAMESPACE)
    const loadedUser = await loadData('user-abc123')

    expect(loadedGuest.feeds[0]!.id).toBe('guest-feed')
    expect(loadedUser.feeds[0]!.id).toBe('user-feed')
  })

  it('clears one namespace without deleting another', async () => {
    const data: AppData = {
      feeds: [{ id: 'f1', amount: 120, occurredAt: '2026-01-01T12:00:00.000Z', comment: '', updatedAt: '2026-01-01T12:00:00.000Z' }],
      weights: [],
    }

    await saveData(data, GUEST_NAMESPACE)
    await saveData(data, 'user-abc123')
    await clearData('user-abc123')

    expect(await loadData('user-abc123')).toEqual({ feeds: [], weights: [] })
    expect((await loadData(GUEST_NAMESPACE)).feeds).toHaveLength(1)
  })

  describe('moving account data to guest', () => {
    it('moves records and clears only the source namespace and its dirty flag', async () => {
      const source = makeData('account-feed')
      source.weights.push({
        id: 'account-weight', kilograms: 4,
        occurredAt: '2026-01-01T12:00:00.000Z', updatedAt: '2026-01-01T12:00:00.000Z',
      })
      await mergeDataStrict(source, 'user-source', true)
      await mergeDataStrict(makeData('other-account'), 'user-other', true)

      expect(await moveDataToGuest('user-source')).toEqual(source)
      expect(await loadData()).toEqual(source)
      expect(await loadData('user-source')).toEqual({ feeds: [], weights: [] })
      expect(await isDirty('user-source')).toBe(false)
      expect(await loadData('user-other')).toEqual(makeData('other-account'))
      expect(await isDirty('user-other')).toBe(true)
      expect(await isDirty(GUEST_NAMESPACE)).toBe(false)
    })

    it('preserves existing guest data and its dirty flag, resolving conflicts by update time', async () => {
      const guest = makeData('shared', 200, '2026-01-01T14:00:00.000Z')
      guest.feeds.push(...makeData('guest-only').feeds)
      const source = makeData('shared', 100)
      source.feeds.push(...makeData('source-only').feeds)
      await mergeDataStrict(guest, GUEST_NAMESPACE, true)
      await saveData(source, 'user-source')

      const moved = await moveDataToGuest('user-source')
      expect(moved.feeds.map(({ id, amount }) => ({ id, amount }))).toEqual([
        { id: 'shared', amount: 200 },
        { id: 'guest-only', amount: 120 },
        { id: 'source-only', amount: 120 },
      ])
      expect(await isDirty(GUEST_NAMESPACE)).toBe(true)
    })

    it('filters source tombstones but retains existing guest tombstones', async () => {
      const source = makeData('active')
      source.feeds.push({
        ...makeData('deleted-source').feeds[0]!,
        deletedAt: '2026-01-02T12:00:00.000Z',
      })
      source.weights.push(
        { id: 'active-weight', kilograms: 4, occurredAt: '2026-01-01T12:00:00.000Z', updatedAt: '2026-01-01T12:00:00.000Z' },
        { id: 'deleted-weight', kilograms: 5, occurredAt: '2026-01-01T12:00:00.000Z', updatedAt: '2026-01-02T12:00:00.000Z', deletedAt: '2026-01-02T12:00:00.000Z' },
      )
      const guest = makeData('guest-tombstone')
      guest.feeds[0]!.deletedAt = '2026-01-02T12:00:00.000Z'
      await saveData(source, 'user-source')
      await saveData(guest)

      const moved = await moveDataToGuest('user-source')
      expect(moved.feeds.map((row) => row.id)).toEqual(['guest-tombstone', 'active'])
      expect(moved.feeds[0]!.deletedAt).toBe('2026-01-02T12:00:00.000Z')
      expect(moved.weights.map((row) => row.id)).toEqual(['active-weight'])
    })

    it('rejects guest as the source without touching its data', async () => {
      await mergeDataStrict(makeData(), GUEST_NAMESPACE, true)
      await expect(moveDataToGuest(GUEST_NAMESPACE)).rejects.toThrow('Cannot move guest data to itself')
      expect(await loadData()).toEqual(makeData())
      expect(await isDirty(GUEST_NAMESPACE)).toBe(true)
    })

    it.each(['guest:data', 'user-source:data'])(
      'leaves both namespaces unchanged when %s is corrupt', async (key) => {
        await mergeDataStrict(makeData('source'), 'user-source', true)
        await saveData(makeData('guest'))
        const raw = driver.getInstance!()
        raw.set(key, '{"feeds":[null],"weights":[]}')
        const before = new Map(raw)

        await expect(moveDataToGuest('user-source')).rejects.toThrow('Invalid app data')
        expect(new Map(raw)).toEqual(before)
        expect(await isDirty('user-source')).toBe(true)
      },
    )

    it('keeps source data and dirty state when writing the guest copy fails', async () => {
      await mergeDataStrict(makeData('source'), 'user-source', true)
      await saveData(makeData('guest'))
      const failure = new DOMException('Storage full', 'QuotaExceededError')
      _setTestDriver({ ...driver, setItem: () => { throw failure } })

      await expect(moveDataToGuest('user-source')).rejects.toBe(failure)
      expect(await loadData('user-source')).toEqual(makeData('source'))
      expect(await isDirty('user-source')).toBe(true)
      expect(await loadData()).toEqual(makeData('guest'))
    })

    it('moves source and guest edits queued before migration without losing either', async () => {
      await saveData(makeData('initial'), 'user-source')
      const [, , moved] = await Promise.all([
        mergeDataStrict(makeData('source-during-delete'), 'user-source', true),
        mergeDataStrict(makeData('guest-during-delete'), GUEST_NAMESPACE),
        moveDataToGuest('user-source'),
      ])
      expect(moved.feeds.map((row) => row.id).sort()).toEqual([
        'guest-during-delete', 'initial', 'source-during-delete',
      ])
      expect(await loadData()).toEqual(moved)
      expect(await loadData('user-source')).toEqual({ feeds: [], weights: [] })
    })

    it('serializes moves from different accounts sharing the guest destination', async () => {
      await saveData(makeData('first'), 'user-first')
      await saveData(makeData('second'), 'user-second')
      await Promise.all([
        moveDataToGuest('user-first'),
        moveDataToGuest('user-second'),
        mergeDataStrict(makeData('guest-after-moves'), GUEST_NAMESPACE),
      ])
      expect((await loadData()).feeds.map((row) => row.id).sort()).toEqual([
        'first', 'guest-after-moves', 'second',
      ])
      expect(await loadData('user-first')).toEqual({ feeds: [], weights: [] })
      expect(await loadData('user-second')).toEqual({ feeds: [], weights: [] })
    })
  })
})
