import { computed, type Ref } from 'vue'
import type { Feed, Weight } from '../types'
import { shortDay } from '../utils/format'
import { dateFromOccurredAt } from '../utils/time'

// ---------------------------------------------------------------------------
// Pure data-series calculation for the trends charts: window resolution and
// aggregation only. Pixel/coordinate math for rendering (bar heights, SVG
// point positions) stays in the component, since it has no reuse case.
// ---------------------------------------------------------------------------

export type TrendRange = '24h' | '7d' | 'all' | 'custom'

export interface ChartPoint {
  label: string
  amount: number
}

export interface TrendCustomRange {
  start: string
  end: string
}

interface DatePeriod {
  start: Date
  end: Date
}

const DAY_MS = 24 * 60 * 60 * 1000
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000

export function chartDateLabel(date: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

function dayLabel(date: Date, range: TrendRange, locale: string) {
  return range === '7d' ? shortDay(date, locale) : chartDateLabel(date, locale)
}

function sumAmount(feeds: Feed[], predicate: (time: number) => boolean) {
  return feeds
    .filter((feed) => predicate(Date.parse(feed.occurredAt)))
    .reduce((total, feed) => total + feed.amount, 0)
}

/**
 * Resolves the day-based [start, end) period for the 7d/all/custom ranges.
 * Returns null for '24h', which uses its own hourly bucketing instead (see
 * `hourlySamples24h`) rather than a day-based period.
 */
function resolvePeriod(
  range: TrendRange,
  customRange: TrendCustomRange,
  feeds: Feed[],
  weights: Weight[],
  now: number,
): DatePeriod | null {
  if (range === '24h') return null

  if (range === '7d') {
    const today = new Date(now)
    today.setHours(0, 0, 0, 0)
    const start = new Date(today)
    start.setDate(start.getDate() - 6)
    const end = new Date(today)
    end.setDate(end.getDate() + 1)
    return { start, end }
  }

  if (range === 'custom') {
    let start = customRange.start ? new Date(`${customRange.start}T00:00`) : null
    let end = customRange.end ? new Date(`${customRange.end}T00:00`) : null
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
    if (start > end) [start, end] = [end, start]
    end.setDate(end.getDate() + 1)
    return { start, end }
  }

  // 'all'. Future-dated records (e.g. from a clock-skewed synced device) are
  // excluded from the earliest-record scan so they can't push the window
  // start into the future.
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const earliestRecord = [...feeds, ...weights]
    .map((record) => Date.parse(record.occurredAt))
    .filter((time) => Number.isFinite(time) && time <= now)
    .reduce((earliest, time) => Math.min(earliest, time), Infinity)
  if (!Number.isFinite(earliestRecord)) return null
  const start = new Date(earliestRecord)
  start.setHours(0, 0, 0, 0)
  const end = new Date(today)
  end.setDate(end.getDate() + 1)
  return { start, end }
}

interface FeedBucket {
  label: string
  start: number
  end: number
}

/**
 * Buckets shared by the intake and bottle-count charts: six 4-hour buckets
 * for '24h', one bucket per calendar day otherwise. Every bucket's end is
 * capped at "now" (inclusive) so a record with a clock-skewed future
 * timestamp can never inflate the current bucket.
 */
function buildFeedBuckets(
  feeds: Feed[],
  weights: Weight[],
  range: TrendRange,
  customRange: TrendCustomRange,
  locale: string,
  now: number,
): FeedBucket[] {
  if (range === '24h') {
    return Array.from({ length: 6 }, (_, index) => {
      const end = now - (5 - index) * FOUR_HOURS_MS
      const start = end - FOUR_HOURS_MS
      return {
        label: new Intl.DateTimeFormat(locale, { hour: '2-digit' }).format(new Date(end)),
        start,
        end: index === 5 ? end + 1 : end,
      }
    })
  }

  const period = resolvePeriod(range, customRange, feeds, weights, now)
  if (!period) return []
  const buckets: FeedBucket[] = []
  for (const date = new Date(period.start); date < period.end; date.setDate(date.getDate() + 1)) {
    const next = new Date(date)
    next.setDate(next.getDate() + 1)
    buckets.push({
      label: dayLabel(date, range, locale),
      start: date.getTime(),
      end: Math.min(next.getTime(), now + 1),
    })
  }
  return buckets
}

function bucketFeeds(feeds: Feed[], buckets: FeedBucket[]): Array<{ label: string; feeds: Feed[] }> {
  return buckets.map((bucket) => ({
    label: bucket.label,
    feeds: feeds.filter((feed) => {
      const time = Date.parse(feed.occurredAt)
      return time >= bucket.start && time < bucket.end
    }),
  }))
}

function buildIntakePoints(buckets: Array<{ label: string; feeds: Feed[] }>): ChartPoint[] {
  return buckets.map((bucket) => ({
    label: bucket.label,
    amount: bucket.feeds.reduce((total, feed) => total + feed.amount, 0),
  }))
}

function buildBottleCountPoints(buckets: Array<{ label: string; feeds: Feed[] }>): ChartPoint[] {
  return buckets.map((bucket) => ({
    label: bucket.label,
    amount: bucket.feeds.length,
  }))
}

function buildVisibleWeights(
  weights: Weight[],
  feeds: Feed[],
  range: TrendRange,
  customRange: TrendCustomRange,
  now: number,
): Weight[] {
  if (range === '24h') {
    const today = dateFromOccurredAt(new Date(now).toISOString())
    return [...weights]
      .filter((weight) => dateFromOccurredAt(weight.occurredAt) === today)
      .sort((a, b) => dateFromOccurredAt(a.occurredAt).localeCompare(dateFromOccurredAt(b.occurredAt)))
  }
  const period = resolvePeriod(range, customRange, feeds, weights, now)
  if (!period) return []
  const startDate = dateFromOccurredAt(period.start.toISOString())
  const endDate = dateFromOccurredAt(period.end.toISOString())
  const today = dateFromOccurredAt(new Date(now).toISOString())
  return [...weights]
    .filter((weight) => {
      const date = dateFromOccurredAt(weight.occurredAt)
      return date >= startDate && date < endDate && date <= today
    })
    .sort((a, b) => dateFromOccurredAt(a.occurredAt).localeCompare(dateFromOccurredAt(b.occurredAt)))
}

/** Six 4-hour samples ending now, shared by the intake and rolling-intake 24h views. */
function hourlySamples24h(locale: string, now: number): Array<{ label: string; end: number }> {
  return Array.from({ length: 6 }, (_, index) => {
    const end = now - (5 - index) * FOUR_HOURS_MS
    return {
      label: new Intl.DateTimeFormat(locale, { hour: '2-digit' }).format(new Date(end)),
      end,
    }
  })
}

function buildRollingIntakePoints(
  feeds: Feed[],
  weights: Weight[],
  range: TrendRange,
  customRange: TrendCustomRange,
  locale: string,
  now: number,
): ChartPoint[] {
  const samples = (() => {
    if (range === '24h') return hourlySamples24h(locale, now)
    const period = resolvePeriod(range, customRange, feeds, weights, now)
    if (!period) return []
    const samples: { label: string; end: number }[] = []
    for (const date = new Date(period.start); date < period.end; date.setDate(date.getDate() + 1)) {
      const next = new Date(date)
      next.setDate(next.getDate() + 1)
      // The trailing 24h window ends at the close of the day, capped at "now"
      // so we never sample into the future.
      samples.push({ label: dayLabel(date, range, locale), end: Math.min(next.getTime(), now) })
    }
    return samples
  })()

  return samples.map((sample) => ({
    label: sample.label,
    amount: sumAmount(feeds, (time) => time >= sample.end - DAY_MS && time <= sample.end),
  }))
}

/**
 * Computes the trends charts' data series (intake, bottle count, visible
 * weights, rolling intake) for the selected range. `customRange` is read
 * reactively via property access, so pass the component's own `reactive()`
 * object directly rather than unwrapping it.
 */
export function useTrendSeries(
  feeds: Ref<Feed[]>,
  weights: Ref<Weight[]>,
  range: Ref<TrendRange>,
  customRange: TrendCustomRange,
  locale: Ref<string>,
  now: Ref<number>,
) {
  // Intake and bottle-count charts share the exact same buckets (six 4-hour
  // buckets for '24h', one per calendar day otherwise); only what's counted
  // in each bucket (amount vs. number of feeds) differs.
  const feedBucketsRef = computed(() =>
    buildFeedBuckets(feeds.value, weights.value, range.value, customRange, locale.value, now.value),
  )
  const bucketedFeeds = computed(() => bucketFeeds(feeds.value, feedBucketsRef.value))

  const intakePoints = computed(() => buildIntakePoints(bucketedFeeds.value))
  const intakeMax = computed(() => Math.max(...intakePoints.value.map((point) => point.amount), 1))

  const bottleCountPoints = computed(() => buildBottleCountPoints(bucketedFeeds.value))
  const bottleCountMax = computed(() => Math.max(...bottleCountPoints.value.map((point) => point.amount), 1))

  const visibleWeights = computed(() =>
    buildVisibleWeights(weights.value, feeds.value, range.value, customRange, now.value),
  )

  const rollingIntakePoints = computed(() =>
    buildRollingIntakePoints(feeds.value, weights.value, range.value, customRange, locale.value, now.value),
  )
  const rollingIntakeMax = computed(() => Math.max(...rollingIntakePoints.value.map((point) => point.amount), 1))
  const rollingIntakeChartWidth = computed(() => Math.max(300, rollingIntakePoints.value.length * 64))

  return {
    intakePoints,
    intakeMax,
    bottleCountPoints,
    bottleCountMax,
    visibleWeights,
    rollingIntakePoints,
    rollingIntakeMax,
    rollingIntakeChartWidth,
  }
}
