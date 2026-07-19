import type { Feed, Weight } from '../types'
import { shortDay } from '../utils/format'

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

export interface ReportFeedChartPoint {
  label: string
  totalAmount: number
  bottleCount: number
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

function startOfDay(date: Date) {
  const value = new Date(date)
  value.setHours(0, 0, 0, 0)
  return value
}

function formatReportChartLabel(date: Date, range: ReportRange, locale: string) {
  if (range === '7d') return shortDay(date, locale)
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(date)
}

function summarizeFeedsInRange(feeds: Feed[], startTime: number, endTime: number) {
  let totalAmount = 0
  let bottleCount = 0

  for (const feed of feeds) {
    const occurredAt = Date.parse(feed.occurredAt)
    if (Number.isNaN(occurredAt) || occurredAt < startTime || occurredAt >= endTime) continue

    totalAmount += feed.amount
    bottleCount++
  }

  return { totalAmount, bottleCount }
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
      const parsedEndDate = parseDateInput(config.endDate)
      const endAt = parsedEndDate ? new Date(parsedEndDate.getTime() + 24 * 60 * 60 * 1000 - 1) : null
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

function sortByOccurredAtDescending<T extends { occurredAt: string }>(items: T[]) {
  return [...items].sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
}

export function createReportSnapshot(
  feeds: Feed[],
  weights: Weight[],
  config: ReportConfig,
  generatedAt = new Date(),
): ReportSnapshot {
  const period = resolveReportPeriod(config, generatedAt)
  const selectedFeeds = config.includeFeeds
    ? sortByOccurredAtDescending(feeds.filter((feed) => isWithinPeriod(feed.occurredAt, period)))
    : []
  const selectedWeights = config.includeWeights
    ? sortByOccurredAtDescending(weights.filter((weight) => isWithinPeriod(weight.occurredAt, period)))
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
    latestWeight: selectedWeights[0] ?? null,
  }
}

export function createReportFeedChartPoints(snapshot: ReportSnapshot, locale: string): ReportFeedChartPoint[] {
  const feeds = [...snapshot.feeds].sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt))
  if (feeds.length === 0) return []

  if (snapshot.period.range === '24h') {
    const windowSize = 4 * 60 * 60 * 1000
    return Array.from({ length: 6 }, (_, index) => {
      const endTime = snapshot.generatedAt.getTime() - (5 - index) * windowSize
      const startTime = endTime - windowSize
      const summary = summarizeFeedsInRange(feeds, startTime, endTime)
      return {
        label: new Intl.DateTimeFormat(locale, { hour: '2-digit' }).format(new Date(endTime)),
        ...summary,
      }
    })
  }

  let startAt: Date
  let endExclusive: Date

  switch (snapshot.period.range) {
    case '7d': {
      endExclusive = startOfDay(snapshot.generatedAt)
      endExclusive.setDate(endExclusive.getDate() + 1)
      startAt = new Date(endExclusive)
      startAt.setDate(startAt.getDate() - 7)
      break
    }
    case 'custom': {
      if (!snapshot.period.startAt || !snapshot.period.endAt) return []
      startAt = startOfDay(snapshot.period.startAt)
      endExclusive = startOfDay(snapshot.period.endAt)
      endExclusive.setDate(endExclusive.getDate() + 1)
      break
    }
    case 'all': {
      const earliestFeed = feeds[0]
      const latestFeed = feeds.at(-1)
      if (!earliestFeed || !latestFeed) return []
      startAt = startOfDay(new Date(earliestFeed.occurredAt))
      endExclusive = startOfDay(new Date(latestFeed.occurredAt))
      endExclusive.setDate(endExclusive.getDate() + 1)
      break
    }
  }

  const points: ReportFeedChartPoint[] = []
  for (const date = new Date(startAt); date < endExclusive; date.setDate(date.getDate() + 1)) {
    const nextDate = new Date(date)
    nextDate.setDate(nextDate.getDate() + 1)
    points.push({
      label: formatReportChartLabel(date, snapshot.period.range, locale),
      ...summarizeFeedsInRange(feeds, date.getTime(), nextDate.getTime()),
    })
  }

  return points
}

export function compactReportFeedChartPoints(points: ReportFeedChartPoint[], maxPoints: number) {
  if (maxPoints <= 0 || points.length <= maxPoints) return points

  const groupSize = Math.ceil(points.length / maxPoints)
  const compacted: ReportFeedChartPoint[] = []

  for (let index = 0; index < points.length; index += groupSize) {
    const group = points.slice(index, index + groupSize)
    const firstPoint = group[0]
    const lastPoint = group.at(-1)
    if (!firstPoint || !lastPoint) continue

    compacted.push({
      label: firstPoint.label === lastPoint.label ? firstPoint.label : `${firstPoint.label}–${lastPoint.label}`,
      totalAmount: group.reduce((total, point) => total + point.totalAmount, 0),
      bottleCount: group.reduce((total, point) => total + point.bottleCount, 0),
    })
  }

  return compacted
}

export function buildReportFilename(date = new Date()) {
  return `little-sips-report-${localDateInput(date)}.pdf`
}
