import type { AppData } from './types'
import { isValidAppData, addMissingMetadata } from './storage'

/** Key used by the original synchronous localStorage implementation. */
export const LEGACY_STORAGE_KEY = 'new-parents-tool:bottle-feeds:v1'

/**
 * Reads legacy localStorage data for migration.
 * Returns the parsed AppData with metadata backfilled if valid, or null.
 * Does NOT remove the legacy data – callers do that only after a
 * successful write to the new store.
 */
export function readLegacyData(
  storage: Pick<Storage, 'getItem'> = localStorage,
): AppData | null {
  try {
    const raw = storage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isValidAppData(parsed)) return null
    return addMissingMetadata(parsed as AppData)
  } catch {
    return null
  }
}
