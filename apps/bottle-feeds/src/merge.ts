import type { AppData, Feed, Weight } from './types'
import { parseAppData } from './validation'

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
    if (!existing || Date.parse(item.updatedAt) >= Date.parse(existing.updatedAt)) {
      map.set(item.id, item)
    }
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
 * Validate imports in full, then merge by update time (import wins ties).
 * Missing legacy metadata is backfilled by the shared parser.
 */
export function mergeImport(existing: AppData, imported: unknown): AppData {
  return mergeAppData(parseAppData(existing), parseAppData(imported))
}
