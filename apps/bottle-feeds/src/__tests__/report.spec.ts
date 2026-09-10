import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { messages } from '../i18n'
import {
  buildReportFilename,
  compactReportFeedChartPoints,
  createReportFeedChartPoints,
  createDefaultReportConfig,
  createReportSnapshot,
  resolveReportPeriod,
  validateReportConfig,
} from '../report/logic'
import { generateReportPdfBlob, sharePdf } from '../report/pdf'
import type { Feed, Weight } from '../types'

async function decodePdfText(blob: Blob) {
  return new TextDecoder('latin1').decode(await blob.arrayBuffer())
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

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
    expect(buildReportFilename(new Date(2026, 6, 19, 10, 15))).toBe('little-sips-report-2026-07-19-10-15.pdf')
  })

  it('creates chart points for feed quantity and bottle count', () => {
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

    const points = createReportFeedChartPoints(snapshot, 'en-GB')

    expect(points).toHaveLength(8)
    expect(points.map((point) => point.label)).toEqual(['12 Jul', '13 Jul', '14 Jul', '15 Jul', '16 Jul', '17 Jul', '18 Jul', '19 Jul'])
    expect(points.map((point) => point.totalAmount)).toEqual([0, 0, 0, 0, 0, 0, 120, 90])
    expect(points.map((point) => point.bottleCount)).toEqual([0, 0, 0, 0, 0, 0, 1, 1])
  })

  it.each(['24h', '7d'] as const)('keeps %s chart totals equal to the snapshot at exact boundaries', (range) => {
    const now = new Date('2026-09-10T12:00:00Z')
    const start = now.getTime() - (range === '24h' ? 1 : 7) * 86_400_000
    const boundaryFeeds = [start - 1, start, start + 4 * 3_600_000, now.getTime(), now.getTime() + 1]
      .map((time, index) => ({
        id: String(index), amount: 120, occurredAt: new Date(time).toISOString(), comment: '', updatedAt: '',
      }))
    const snapshot = createReportSnapshot(boundaryFeeds, [], { ...createDefaultReportConfig(now), range }, now)
    const points = createReportFeedChartPoints(snapshot, 'en-GB')

    expect(snapshot.feedSummary).toMatchObject({ count: 3, totalAmount: 360 })
    expect(points.reduce((sum, point) => sum + point.totalAmount, 0)).toBe(360)
    expect(points.reduce((sum, point) => sum + point.bottleCount, 0)).toBe(3)
  })

  it('retains the first partial day of a rolling seven-day report', () => {
    const now = new Date('2026-09-10T12:00:00+02:00')
    const snapshot = createReportSnapshot([
      { id: 'partial', amount: 120, occurredAt: '2026-09-03T18:00:00+02:00', comment: '', updatedAt: '' },
    ], [], { ...createDefaultReportConfig(now), range: '7d' }, now)
    const points = createReportFeedChartPoints(snapshot, 'en-GB')

    expect(points[0]).toMatchObject({ totalAmount: 120, bottleCount: 1 })
    expect(points.reduce((sum, point) => sum + point.totalAmount, 0)).toBe(snapshot.feedSummary.totalAmount)
  })

  it.each(['2026-03-29', '2026-10-25'])('ends custom date %s at the following local midnight, exclusively', (date) => {
    const config = { ...createDefaultReportConfig(), range: 'custom' as const, startDate: date, endDate: date }
    const nextMidnight = new Date(`${date}T00:00:00`)
    nextMidnight.setDate(nextMidnight.getDate() + 1)
    const period = resolveReportPeriod(config)
    expect(period.endAt?.getTime()).toBe(nextMidnight.getTime() - 1)

    const snapshot = createReportSnapshot([
      { id: 'last', amount: 120, occurredAt: new Date(nextMidnight.getTime() - 1).toISOString(), comment: '', updatedAt: '' },
      { id: 'next', amount: 90, occurredAt: nextMidnight.toISOString(), comment: '', updatedAt: '' },
    ], [], config)
    expect(snapshot.feeds.map((feed) => feed.id)).toEqual(['last'])
    expect(createReportFeedChartPoints(snapshot, 'en-GB')).toHaveLength(1)
  })

  it('compacts chart points for long report ranges', () => {
    const points = compactReportFeedChartPoints(
      [
        { label: '1 Jul', totalAmount: 80, bottleCount: 1 },
        { label: '2 Jul', totalAmount: 100, bottleCount: 1 },
        { label: '3 Jul', totalAmount: 120, bottleCount: 2 },
        { label: '4 Jul', totalAmount: 90, bottleCount: 1 },
      ],
      2,
    )

    expect(points).toEqual([
      { label: '1 Jul–2 Jul', totalAmount: 180, bottleCount: 2 },
      { label: '3 Jul–4 Jul', totalAmount: 210, bottleCount: 3 },
    ])
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

  it('shares the PDF through the native share sheet when file sharing is supported', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const canShare = vi.fn(() => true)
    vi.stubGlobal('navigator', { share, canShare })

    await expect(sharePdf(new Blob(['pdf'], { type: 'application/pdf' }), 'report.pdf')).resolves.toBe('shared')

    expect(canShare).toHaveBeenCalledOnce()
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [expect.objectContaining({ name: 'report.pdf', type: 'application/pdf' })],
      }),
    )
  })

  it('downloads the PDF when native file sharing is unavailable', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const createObjectURL = vi.fn(() => 'blob:report')
    const revokeObjectURL = vi.fn()
    const share = vi.fn()
    vi.stubGlobal('navigator', { share, canShare: vi.fn(() => false) })
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })

    await expect(sharePdf(new Blob(['pdf'], { type: 'application/pdf' }), 'report.pdf')).resolves.toBe('downloaded')

    expect(click).toHaveBeenCalledOnce()
    expect(share).not.toHaveBeenCalled()
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report')
  })

  it('downloads the PDF when the browser cannot verify file sharing support', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:report'),
      revokeObjectURL: vi.fn(),
    })

    await expect(sharePdf(new Blob(['pdf'], { type: 'application/pdf' }), 'report.pdf')).resolves.toBe('downloaded')

    expect(click).toHaveBeenCalledOnce()
  })

  it('returns cancelled when the native share sheet is dismissed', async () => {
    vi.stubGlobal('navigator', {
      canShare: vi.fn(() => true),
      share: vi.fn().mockRejectedValue(new DOMException('Dismissed', 'AbortError')),
    })

    await expect(sharePdf(new Blob(['pdf'], { type: 'application/pdf' }), 'report.pdf')).resolves.toBe('cancelled')
  })

  it('rethrows native sharing errors other than cancellation', async () => {
    const error = new Error('Sharing failed')
    vi.stubGlobal('navigator', {
      canShare: vi.fn(() => true),
      share: vi.fn().mockRejectedValue(error),
    })

    await expect(sharePdf(new Blob(['pdf'], { type: 'application/pdf' }), 'report.pdf')).rejects.toBe(error)
  })

  it('renders compacted chart values into the PDF output', async () => {
    const chartFeeds: Feed[] = Array.from({ length: 9 }, (_, index) => ({
      id: `chart-feed-${index + 1}`,
      amount: (index + 1) * 10,
      occurredAt: `2026-07-${String(index + 1).padStart(2, '0')}T08:00:00.000Z`,
      comment: '',
      updatedAt: `2026-07-${String(index + 1).padStart(2, '0')}T08:00:00.000Z`,
    }))
    const snapshot = createReportSnapshot(
      chartFeeds,
      [],
      {
        range: 'all',
        startDate: '2026-07-01',
        endDate: '2026-07-09',
        includeFeeds: true,
        includeWeights: false,
        includeComments: false,
      },
      new Date('2026-07-09T10:15:00.000Z'),
    )

    const blob = await generateReportPdfBlob(snapshot, messages.en, 'en-GB')
    const pdfText = await decodePdfText(blob)

    expect(pdfText).toContain('110 ml')
    expect(pdfText).toContain('150 ml')
  })

  it('omits report metadata rows from the PDF output', async () => {
    const snapshot = createReportSnapshot(
      feeds,
      weights,
      {
        range: 'custom',
        startDate: '2026-07-10',
        endDate: '2026-07-19',
        includeFeeds: true,
        includeWeights: true,
        includeComments: true,
      },
      new Date('2026-07-19T10:15:00.000Z'),
    )

    const blob = await generateReportPdfBlob(snapshot, messages.en, 'en-GB')
    const pdfText = await decodePdfText(blob)

    expect(pdfText).not.toContain(messages.en.reportCoveredRange)
    expect(pdfText).not.toContain(messages.en.reportGeneratedAt)
  })
})
