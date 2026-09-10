import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { reactive, ref } from 'vue'
import { useTrendSeries, type TrendRange } from '../composables/useTrendSeries'
import type { Feed, Weight } from '../types'

function feed(id: string, amount: number, occurredAt: string): Feed {
  return { id, amount, occurredAt, comment: '', updatedAt: occurredAt }
}

function weight(id: string, kilograms: number, occurredAt: string): Weight {
  return { id, kilograms, occurredAt, updatedAt: occurredAt }
}

function setup(feedsData: Feed[], weightsData: Weight[], range: TrendRange, now = Date.now()) {
  const feeds = ref(feedsData)
  const weights = ref(weightsData)
  const rangeRef = ref(range)
  const customRange = reactive({ start: '', end: '' })
  const locale = ref('en-GB')
  const nowRef = ref(now)
  return { ...useTrendSeries(feeds, weights, rangeRef, customRange, locale, nowRef), rangeRef, customRange, nowRef }
}

describe('useTrendSeries', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('buckets 24h intake and bottle count into the same six 4-hour samples', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-19T12:00:00.000Z'))

    const feeds = [
      feed('f1', 90, '2026-07-18T08:00:00.000Z'), // more than 24h ago, excluded
      feed('f2', 100, '2026-07-19T09:00:00.000Z'), // within the last 4h bucket
      feed('f3', 50, '2026-07-19T11:00:00.000Z'), // within the last 4h bucket
    ]

    const { intakePoints, bottleCountPoints } = setup(feeds, [], '24h')

    expect(intakePoints.value).toHaveLength(6)
    expect(intakePoints.value.reduce((total, point) => total + point.amount, 0)).toBe(150)

    // bottleCount shares the exact same 4-hour buckets as intake.
    expect(bottleCountPoints.value).toHaveLength(6)
    expect(bottleCountPoints.value.reduce((total, point) => total + point.amount, 0)).toBe(2)
  })

  it('aggregates intake and bottle counts per day over a 7 day range', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-19T12:00:00.000Z'))

    const feeds = [
      feed('f1', 100, '2026-07-13T08:00:00.000Z'),
      feed('f2', 120, '2026-07-13T20:00:00.000Z'),
      feed('f3', 90, '2026-07-19T08:00:00.000Z'),
    ]

    const { intakePoints, bottleCountPoints } = setup(feeds, [], '7d')

    expect(intakePoints.value).toHaveLength(7)
    expect(intakePoints.value[0]!.amount).toBe(220)
    expect(intakePoints.value[6]!.amount).toBe(90)
    expect(bottleCountPoints.value[0]!.amount).toBe(2)
    expect(bottleCountPoints.value[6]!.amount).toBe(1)
  })

  it('spans from the earliest record to today for the "all" range', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-19T12:00:00.000Z'))

    const feeds = [feed('f1', 100, '2026-07-01T08:00:00.000Z')]
    const weights = [weight('w1', 4, '2026-07-01T08:00:00.000Z')]

    const { intakePoints } = setup(feeds, weights, 'all')

    expect(intakePoints.value).toHaveLength(19) // Jul 1 through Jul 19 inclusive
    expect(intakePoints.value[0]!.amount).toBe(100)
  })

  it('respects a custom date range regardless of start/end order', () => {
    const feeds = [
      feed('f1', 100, '2026-07-10T08:00:00.000Z'),
      feed('f2', 50, '2026-07-12T08:00:00.000Z'),
      feed('f3', 999, '2026-07-20T08:00:00.000Z'),
    ]

    const { intakePoints, customRange } = setup(feeds, [], 'custom')
    customRange.start = '2026-07-12'
    customRange.end = '2026-07-10'

    expect(intakePoints.value).toHaveLength(3)
    expect(intakePoints.value.reduce((total, point) => total + point.amount, 0)).toBe(150)
  })

  it('only includes weights within the selected range, sorted chronologically', () => {
    const weights = [
      weight('w1', 4.5, '2026-07-15T08:00:00.000Z'),
      weight('w2', 4.2, '2026-07-10T08:00:00.000Z'),
      weight('w3', 5.0, '2026-06-01T08:00:00.000Z'),
    ]

    const { visibleWeights, customRange } = setup([], weights, 'custom')
    customRange.start = '2026-07-01'
    customRange.end = '2026-07-31'

    expect(visibleWeights.value.map((w) => w.id)).toEqual(['w2', 'w1'])
  })

  it('computes rolling 24h intake per day, capped at the current time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-19T12:00:00.000Z'))

    const feeds = [
      feed('f1', 100, '2026-07-18T20:00:00.000Z'),
      feed('f2', 50, '2026-07-19T06:00:00.000Z'),
    ]

    const { rollingIntakePoints } = setup(feeds, [], '7d')

    expect(rollingIntakePoints.value).toHaveLength(7)
    const lastPoint = rollingIntakePoints.value[6]!
    // Trailing 24h ending "now" (2026-07-19T12:00Z) includes both feeds.
    expect(lastPoint.amount).toBe(150)
  })
})
