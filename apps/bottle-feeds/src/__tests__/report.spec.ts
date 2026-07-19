import { describe, expect, it } from 'vite-plus/test'

import { messages } from '../i18n'
import {
  buildReportFilename,
  createDefaultReportConfig,
  createReportSnapshot,
  validateReportConfig,
} from '../report/logic'
import { generateReportPdfBlob } from '../report/pdf'
import type { Feed, Weight } from '../types'

describe('report logic', () => {
  const feeds: Feed[] = [
    {
      id: 'feed-older',
      amount: 80,
      occurredAt: '2026-07-10T08:00:00.000Z',
      comment: 'Slept afterwards',
      updatedAt: '2026-07-10T08:00:00.000Z',
    },
    {
      id: 'feed-recent',
      amount: 120,
      occurredAt: '2026-07-18T12:30:00.000Z',
      comment: 'Drank quickly',
      updatedAt: '2026-07-18T12:30:00.000Z',
    },
    {
      id: 'feed-latest',
      amount: 90,
      occurredAt: '2026-07-19T09:00:00.000Z',
      comment: '',
      updatedAt: '2026-07-19T09:00:00.000Z',
    },
  ]

  const weights: Weight[] = [
    {
      id: 'weight-earlier',
      kilograms: 4.1,
      occurredAt: '2026-07-12T10:00:00.000Z',
      updatedAt: '2026-07-12T10:00:00.000Z',
    },
    {
      id: 'weight-latest',
      kilograms: 4.25,
      occurredAt: '2026-07-19T07:45:00.000Z',
      updatedAt: '2026-07-19T07:45:00.000Z',
    },
  ]

  it('defaults to a 24-hour report with feeds, weights, and comments included', () => {
    const config = createDefaultReportConfig(new Date('2026-07-19T10:15:00.000Z'))

    expect(config).toMatchObject({
      range: '24h',
      startDate: '2026-07-19',
      endDate: '2026-07-19',
      includeFeeds: true,
      includeWeights: true,
      includeComments: true,
    })
  })

  it('validates category selection and custom date ordering', () => {
    expect(
      validateReportConfig({
        range: '24h',
        startDate: '2026-07-19',
        endDate: '2026-07-19',
        includeFeeds: false,
        includeWeights: false,
        includeComments: true,
      }),
    ).toEqual(['categories'])

    expect(
      validateReportConfig({
        range: 'custom',
        startDate: '2026-07-20',
        endDate: '2026-07-19',
        includeFeeds: true,
        includeWeights: false,
        includeComments: true,
      }),
    ).toEqual(['dateOrder'])
  })

  it('filters and summarizes the selected period with newest entries first', () => {
    const snapshot = createReportSnapshot(
      feeds,
      weights,
      {
        range: '24h',
        startDate: '2026-07-19',
        endDate: '2026-07-19',
        includeFeeds: true,
        includeWeights: true,
        includeComments: true,
      },
      new Date('2026-07-19T10:15:00.000Z'),
    )

    expect(snapshot.feeds.map((feed) => feed.id)).toEqual(['feed-latest', 'feed-recent'])
    expect(snapshot.weights.map((weight) => weight.id)).toEqual(['weight-latest'])
    expect(snapshot.feedSummary).toEqual({ count: 2, totalAmount: 210, averageAmount: 105 })
    expect(snapshot.latestWeight?.id).toBe('weight-latest')
  })

  it('includes the full custom end date and respects excluded sections', () => {
    const snapshot = createReportSnapshot(
      feeds,
      weights,
      {
        range: 'custom',
        startDate: '2026-07-10',
        endDate: '2026-07-18',
        includeFeeds: true,
        includeWeights: false,
        includeComments: false,
      },
      new Date('2026-07-19T10:15:00.000Z'),
    )

    expect(snapshot.feeds.map((feed) => feed.id)).toEqual(['feed-recent', 'feed-older'])
    expect(snapshot.weights).toEqual([])
    expect(snapshot.config.includeComments).toBe(false)
  })

  it('builds the requested report filename pattern', () => {
    expect(buildReportFilename(new Date('2026-07-19T10:15:00.000Z'))).toBe('little-sips-report-2026-07-19.pdf')
  })

  it('generates a PDF blob for browser download', async () => {
    const snapshot = createReportSnapshot(
      feeds,
      weights,
      {
        range: '7d',
        startDate: '2026-07-12',
        endDate: '2026-07-19',
        includeFeeds: true,
        includeWeights: true,
        includeComments: true,
      },
      new Date('2026-07-19T10:15:00.000Z'),
    )

    const blob = await generateReportPdfBlob(snapshot, messages.en, 'en-GB')
    const header = new Uint8Array(await blob.arrayBuffer()).slice(0, 4)

    expect(blob.type).toBe('application/pdf')
    expect(Array.from(header)).toEqual([37, 80, 68, 70])
  })
})
