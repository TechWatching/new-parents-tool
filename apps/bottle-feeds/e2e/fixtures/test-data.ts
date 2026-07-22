import type { AppData, Feed, Weight } from '../../src/types'

/**
 * A fixed reference date used as "now" in tests that need a stable
 * point-in-time (2026-07-15 at 12:00 UTC).
 */
export const REFERENCE_DATE = '2026-07-15T12:00:00.000Z'

/** Sample bottle feeds covering the last few days. */
export const sampleFeeds: Feed[] = [
  {
    id: 'feed-1',
    amount: 120,
    occurredAt: '2026-07-15T10:30:00.000Z',
    comment: 'Drank quickly',
    updatedAt: '2026-07-15T10:30:00.000Z',
  },
  {
    id: 'feed-2',
    amount: 100,
    occurredAt: '2026-07-15T07:00:00.000Z',
    comment: '',
    updatedAt: '2026-07-15T07:00:00.000Z',
  },
  {
    id: 'feed-3',
    amount: 110,
    occurredAt: '2026-07-14T20:00:00.000Z',
    comment: 'A bit sleepy',
    updatedAt: '2026-07-14T20:00:00.000Z',
  },
  {
    id: 'feed-4',
    amount: 130,
    occurredAt: '2026-07-14T14:00:00.000Z',
    comment: '',
    updatedAt: '2026-07-14T14:00:00.000Z',
  },
  {
    id: 'feed-5',
    amount: 90,
    occurredAt: '2026-07-14T08:00:00.000Z',
    comment: 'Drank slowly',
    updatedAt: '2026-07-14T08:00:00.000Z',
  },
  {
    id: 'feed-6',
    amount: 115,
    occurredAt: '2026-07-13T19:30:00.000Z',
    comment: '',
    updatedAt: '2026-07-13T19:30:00.000Z',
  },
  {
    id: 'feed-7',
    amount: 105,
    occurredAt: '2026-07-13T13:00:00.000Z',
    comment: '',
    updatedAt: '2026-07-13T13:00:00.000Z',
  },
]

/** Sample weight measurements over several weeks. */
export const sampleWeights: Weight[] = [
  {
    id: 'weight-1',
    kilograms: 4.2,
    occurredAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
  },
  {
    id: 'weight-2',
    kilograms: 4.0,
    occurredAt: '2026-07-08T00:00:00.000Z',
    updatedAt: '2026-07-08T00:00:00.000Z',
  },
  {
    id: 'weight-3',
    kilograms: 3.8,
    occurredAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  },
]

/** Full dataset combining all feeds and weights. */
export const fullAppData: AppData = {
  feeds: sampleFeeds,
  weights: sampleWeights,
}

/** Minimal dataset with a single feed and one weight (useful for focused tests). */
export const minimalAppData: AppData = {
  feeds: [sampleFeeds[0]!],
  weights: [sampleWeights[0]!],
}
