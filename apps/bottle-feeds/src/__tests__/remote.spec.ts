import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const supabaseSpies = vi.hoisted(() => ({
  from: vi.fn(),
  results: new Map<string, { error: Error | null }>(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: supabaseSpies.from,
  },
}))

import { deleteAllCloudData } from '../remote'

describe('deleteAllCloudData', () => {
  beforeEach(() => {
    supabaseSpies.results.clear()
    supabaseSpies.from.mockReset()
    supabaseSpies.from.mockImplementation((table: string) => ({
      delete: () => ({
        eq: async (column: string, userId: string) => {
          // Oxlint cannot associate assertions inside the deferred mock callback with the test.
          // oxlint-disable-next-line vitest/no-standalone-expect
          expect(column).toBe('user_id')
          // oxlint-disable-next-line vitest/no-standalone-expect
          expect(userId).toBe('user-123')
          return supabaseSpies.results.get(table) ?? { error: null }
        },
      }),
    }))
  })

  it('deletes feeds and weights owned by the user', async () => {
    await deleteAllCloudData('user-123')

    expect(supabaseSpies.from).toHaveBeenCalledWith('feeds')
    expect(supabaseSpies.from).toHaveBeenCalledWith('weights')
  })

  it('surfaces a cloud deletion error', async () => {
    supabaseSpies.results.set('weights', { error: new Error('delete failed') })

    await expect(deleteAllCloudData('user-123')).rejects.toThrow('delete failed')
  })
})
