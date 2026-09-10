import type { AppData, Feed, Weight } from './types'

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid app data: expected a record')
  }
  return value as Record<string, unknown>
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid app data: expected a timestamp')
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!parts) throw new Error('Invalid app data: expected an ISO timestamp')
  const year = Number(parts[1])
  const month = Number(parts[2])
  const day = Number(parts[3])
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  const time = Date.parse(value)
  if (
    month < 1 || month > 12 || day < 1 || day > days[month - 1]! ||
    Number(parts[4]) > 23 || Number(parts[5]) > 59 || Number(parts[6] ?? 0) > 59 ||
    !Number.isFinite(time)
  ) {
    throw new Error('Invalid app data: invalid timestamp')
  }
  return new Date(time).toISOString()
}

function metadata(row: Record<string, unknown>, ids: Set<string>) {
  if (typeof row.id !== 'string' || !row.id.trim() || ids.has(row.id)) {
    throw new Error('Invalid app data: missing or duplicate record ID')
  }
  ids.add(row.id)
  const occurredAt = timestamp(row.occurredAt)
  return {
    id: row.id,
    occurredAt,
    updatedAt: row.updatedAt === undefined ? occurredAt : timestamp(row.updatedAt),
    ...(row.deletedAt === undefined ? {} : { deletedAt: timestamp(row.deletedAt) }),
  }
}

function quantity(value: unknown, min: number, max: number, integer = false): number {
  if (
    typeof value !== 'number' || !Number.isFinite(value) ||
    value < min || value > max || (integer && !Number.isInteger(value))
  ) {
    throw new Error('Invalid app data: quantity is out of range')
  }
  return value
}

/** Validate the entire payload before returning fresh, canonical records. */
export function parseAppData(value: unknown): AppData {
  const data = record(value)
  if (!Array.isArray(data.feeds) || !Array.isArray(data.weights)) {
    throw new Error('Invalid app data: expected feeds and weights arrays')
  }
  const feedIds = new Set<string>()
  const weightIds = new Set<string>()
  const feeds = Array.from(data.feeds, (value: unknown): Feed => {
    const row = record(value)
    const comment = row.comment === undefined ? '' : row.comment
    if (typeof comment !== 'string' || comment.length > 160) {
      throw new Error('Invalid app data: invalid comment')
    }
    return {
      ...metadata(row, feedIds),
      amount: quantity(row.amount, 1, 2000, true),
      comment,
    }
  })
  const weights = Array.from(data.weights, (value: unknown): Weight => {
    const row = record(value)
    return { ...metadata(row, weightIds), kilograms: quantity(row.kilograms, 0.1, 50) }
  })
  return { feeds, weights }
}

export function isValidAppData(value: unknown): value is AppData {
  try {
    parseAppData(value)
    return true
  } catch {
    return false
  }
}

/** Keep the legacy helper while sharing the strict import/storage parser. */
export function addMissingMetadata(value: unknown): AppData {
  return parseAppData(value)
}
