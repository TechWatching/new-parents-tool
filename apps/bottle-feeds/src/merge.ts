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

/** Only offer guest records that the selected family has not already absorbed. */
export function unmergedGuestData(guest: AppData, family: AppData): AppData {
  function remaining<T extends { id: string; updatedAt: string; deletedAt?: string }>(
    records: T[], familyRecords: T[],
  ): T[] {
    const byId = new Map(familyRecords.map((record) => [record.id, record]))
    return records.filter((record) => {
      if (record.deletedAt) return false
      const existing = byId.get(record.id)
      if (!existing) return true
      const difference = Date.parse(record.updatedAt) - Date.parse(existing.updatedAt)
      return difference > 0 || (difference === 0 && JSON.stringify(record) !== JSON.stringify(existing))
    })
  }
  return {
    feeds: remaining(guest.feeds, family.feeds),
    weights: remaining(guest.weights, family.weights),
  }
}

/**
 * Validate imports in full, then merge by update time (import wins ties).
 * Missing legacy metadata is backfilled by the shared parser.
 */
export function mergeImport(existing: AppData, imported: unknown): AppData {
  return mergeAppData(parseAppData(existing), parseAppData(imported))
}
