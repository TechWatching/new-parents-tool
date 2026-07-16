import { describe, expect, it, vi } from 'vite-plus/test'

import { loadData, saveData, STORAGE_KEY } from '../storage'

describe('local storage', () => {
  it('returns empty collections for corrupt data', () => {
    expect(loadData({ getItem: () => 'not-json' })).toEqual({ feeds: [], weights: [] })
  })

  it('saves data under the versioned key', () => {
    const setItem = vi.fn<(key: string, value: string) => void>()
    const data = { feeds: [], weights: [] }

    saveData(data, { setItem })

    expect(setItem).toHaveBeenCalledWith(STORAGE_KEY, JSON.stringify(data))
  })
})
