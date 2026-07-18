import type { AppData, Feed, Weight } from './types'

/**
 * Deterministic merge: newest `updatedAt` wins.
 * Tombstones (deletedAt set) are kept in the result so they can
 * propagate to other devices; callers that want only active records
 * must filter on their own.
 */
function mergeRecords<T extends { id: string; updatedAt: string }>(local: T[], remote: T[]): T[] {
  const map = new Map<string, T>()
  for (const item of local) map.set(item.id, item)
  for (const item of remote) {
    const existing = map.get(item.id)
    if (!existing || item.updatedAt >= existing.updatedAt) map.set(item.id, item)
  }
  return Array.from(map.values())
}

export function mergeFeeds(local: Feed[], remote: Feed[]): Feed[] {
  return mergeRecords(local, remote)
}

export function mergeWeights(local: Weight[], remote: Weight[]): Weight[] {
  return mergeRecords(local, remote)
}

export function mergeAppData(local: AppData, remote: AppData): AppData {
  return {
    feeds: mergeFeeds(local.feeds, remote.feeds),
    weights: mergeWeights(local.weights, remote.weights),
  }
}

/**
 * Merge two sets of records for JSON import: remote (imported) wins
 * on conflict by ID; missing `updatedAt` is backfilled from `occurredAt`.
 */
export function mergeImport(existing: AppData, imported: AppData): AppData {
  const now = new Date().toISOString()
  const backfill = <T extends { updatedAt?: string; occurredAt: string }>(items: T[]): T[] =>
    items.map((item) => ({ ...item, updatedAt: item.updatedAt ?? item.occurredAt ?? now }))
  return mergeAppData(existing, {
    feeds: backfill(imported.feeds) as Feed[],
    weights: backfill(imported.weights) as Weight[],
  })
}
