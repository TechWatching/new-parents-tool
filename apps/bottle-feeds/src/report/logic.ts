import type { Feed, Weight } from '../types'

export type ReportRange = '24h' | '7d' | 'all' | 'custom'

export interface ReportConfig {
  range: ReportRange
  startDate: string
  endDate: string
  includeFeeds: boolean
  includeWeights: boolean
  includeComments: boolean
}

export type ReportValidationError =
  | 'categories'
  | 'startDate'
  | 'endDate'
  | 'dateOrder'

export interface ReportPeriod {
  range: ReportRange
  startAt: Date | null
  endAt: Date | null
}

export interface FeedSummary {
  count: number
  totalAmount: number
  averageAmount: number | null
}

export interface ReportSnapshot {
  config: ReportConfig
  generatedAt: Date
  period: ReportPeriod
  feeds: Feed[]
  weights: Weight[]
  feedSummary: FeedSummary
  latestWeight: Weight | null
}

function localDateInput(date: Date) {
  const local = new Date(date)
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset())
  return local.toISOString().slice(0, 10)
}

function parseDateInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

export function createDefaultReportConfig(now = new Date()): ReportConfig {
  const today = localDateInput(now)
  return {
    range: '24h',
    startDate: today,
    endDate: today,
    includeFeeds: true,
    includeWeights: true,
    includeComments: true,
  }
}

export function validateReportConfig(config: ReportConfig): ReportValidationError[] {
  const errors: ReportValidationError[] = []

  if (!config.includeFeeds && !config.includeWeights) {
    errors.push('categories')
  }

  if (config.range !== 'custom') return errors

  const startAt = parseDateInput(config.startDate)
  const endAt = parseDateInput(config.endDate)

  if (!startAt) errors.push('startDate')
  if (!endAt) errors.push('endDate')
  if (startAt && endAt && startAt.getTime() > endAt.getTime()) errors.push('dateOrder')

  return errors
}

export function resolveReportPeriod(config: ReportConfig, now = new Date()): ReportPeriod {
  switch (config.range) {
    case '24h':
      return {
        range: config.range,
        startAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        endAt: now,
      }
    case '7d':
      return {
        range: config.range,
        startAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        endAt: now,
      }
    case 'all':
      return { range: config.range, startAt: null, endAt: null }
    case 'custom': {
      const startAt = parseDateInput(config.startDate)
      const endStart = parseDateInput(config.endDate)
      const endAt = endStart ? new Date(endStart.getTime() + 24 * 60 * 60 * 1000 - 1) : null
      return { range: config.range, startAt, endAt }
    }
  }
}

function isWithinPeriod(occurredAt: string, period: ReportPeriod) {
  const timestamp = Date.parse(occurredAt)
  if (Number.isNaN(timestamp)) return false
  if (period.startAt && timestamp < period.startAt.getTime()) return false
  if (period.endAt && timestamp > period.endAt.getTime()) return false
  return true
}

function sortChronologically<T extends { occurredAt: string }>(items: T[]) {
  return [...items].sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt))
}

export function createReportSnapshot(
  feeds: Feed[],
  weights: Weight[],
  config: ReportConfig,
  generatedAt = new Date(),
): ReportSnapshot {
  const period = resolveReportPeriod(config, generatedAt)
  const selectedFeeds = config.includeFeeds ? sortChronologically(feeds.filter((feed) => isWithinPeriod(feed.occurredAt, period))) : []
  const selectedWeights = config.includeWeights
    ? sortChronologically(weights.filter((weight) => isWithinPeriod(weight.occurredAt, period)))
    : []

  const count = selectedFeeds.length
  const totalAmount = selectedFeeds.reduce((total, feed) => total + feed.amount, 0)

  return {
    config: { ...config },
    generatedAt,
    period,
    feeds: selectedFeeds,
    weights: selectedWeights,
    feedSummary: {
      count,
      totalAmount,
      averageAmount: count > 0 ? totalAmount / count : null,
    },
    latestWeight: selectedWeights.at(-1) ?? null,
  }
}

export function buildReportFilename(date = new Date()) {
  return `little-sips-report-${localDateInput(date)}.pdf`
}
