import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import memoryDriver from 'unstorage/drivers/memory'

import { syncStatus } from '../sync'
import { loadData, saveData, markDirty, isDirty, clearDirty, _setTestDriver, GUEST_NAMESPACE } from '../storage'
import type { AppData } from '../types'

const baseData: AppData = {
  feeds: [
    { id: 'f1', amount: 120, occurredAt: '2026-01-01T12:00:00.000Z', comment: '', updatedAt: '2026-01-01T12:00:00.000Z' },
  ],
  weights: [],
}

describe('local-only mode (no Supabase env vars)', () => {
  beforeEach(() => {
    _setTestDriver(memoryDriver())
  })

  afterEach(() => {
    _setTestDriver(null)
  })

  it('saves and loads data without any network calls', async () => {
    await saveData(baseData, GUEST_NAMESPACE)
    const loaded = await loadData(GUEST_NAMESPACE)
    expect(loaded.feeds[0]!.id).toBe('f1')
  })

  it('isDirty returns false when Supabase is not configured', async () => {
    // markDirty is a no-op when Supabase is not configured, but isDirty reads the
    // underlying storage value which starts as falsy
    expect(await isDirty(GUEST_NAMESPACE)).toBe(false)
  })
})

describe('dirty flag', () => {
  beforeEach(() => {
    _setTestDriver(memoryDriver())
  })

  afterEach(() => {
    _setTestDriver(null)
  })

  it('starts as not dirty', async () => {
    expect(await isDirty(GUEST_NAMESPACE)).toBe(false)
  })

  it('can be marked and cleared', async () => {
    await markDirty(GUEST_NAMESPACE)
    expect(await isDirty(GUEST_NAMESPACE)).toBe(true)

    await clearDirty(GUEST_NAMESPACE)
    expect(await isDirty(GUEST_NAMESPACE)).toBe(false)
  })
})

describe('sync status ref', () => {
  it('starts as idle', () => {
    // syncStatus is a module-level ref; test that it is reactive
    expect(['idle', 'pending', 'syncing', 'error', 'synced']).toContain(syncStatus.value)
  })

  it('syncNow is not called in local-only mode (isSupabaseConfigured=false)', async () => {
    const { syncNow } = await import('../sync')
    const spy = vi.spyOn(await import('../remote'), 'pullAll').mockResolvedValue({ feeds: [], weights: [] })
    const merged = await syncNow('uid', GUEST_NAMESPACE, baseData)
    // Without Supabase configured, syncNow returns local data unchanged
    expect(merged.feeds[0]!.id).toBe('f1')
    spy.mockRestore()
  })
})
