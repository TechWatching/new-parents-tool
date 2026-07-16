import type { AppData } from './types'

export const STORAGE_KEY = 'new-parents-tool:bottle-feeds:v1'

const emptyData = (): AppData => ({ feeds: [], weights: [] })

export function loadData(storage: Pick<Storage, 'getItem'> = localStorage): AppData {
  try {
    const value = storage.getItem(STORAGE_KEY)
    if (!value) return emptyData()

    const parsed: unknown = JSON.parse(value)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !Array.isArray((parsed as AppData).feeds) ||
      !Array.isArray((parsed as AppData).weights)
    ) {
      return emptyData()
    }

    return parsed as AppData
  } catch {
    return emptyData()
  }
}

export function saveData(data: AppData, storage: Pick<Storage, 'setItem'> = localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(data))
}
