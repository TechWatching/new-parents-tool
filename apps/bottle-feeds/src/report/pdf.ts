import type { Messages } from '../i18n'
import type { Feed, Weight } from '../types'
import {
  compactReportFeedChartPoints,
  createReportFeedChartPoints,
  type ReportFeedChartPoint,
  type ReportSnapshot,
} from './logic'

const PAGE_MARGIN = 40
const PAGE_FOOTER = 28
const TABLE_BOTTOM_MARGIN = 36
const META_VALUE_OFFSET = 14
const META_LINE_HEIGHT = 13
const CHART_GAP = 16
const CHART_HEIGHT = 172
const CHART_TITLE_OFFSET = 18
const CHART_CONTENT_TOP = 34
const CHART_CONTENT_BOTTOM = 28
const CHART_CONTENT_SIDE = 16
const CHART_LABEL_SPACE = 24
const CHART_BAR_MIN_HEIGHT = 4
const CHART_BAR_SCALE_PADDING = 6
const CHART_BAR_VALUE_MIN_TOP = 8
const CHART_BAR_VALUE_OFFSET = 4
const CHART_X_LABEL_WIDTH_PADDING = 8
const CHART_X_LABEL_MAX_LINES = 2
const CHART_X_LABEL_OFFSET = 10
const CHART_COLOR_MILK: [number, number, number] = [236, 121, 108]
const CHART_COLOR_BOTTLES: [number, number, number] = [90, 156, 135]

type AutoTableDoc = {
  lastAutoTable?: {
    finalY?: number
  }
}

function formatDateTime(value: Date | string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(typeof value === 'string' ? new Date(value) : value)
}

function formatDate(value: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(value)
}

function formatNumber(value: number, locale: string, maximumFractionDigits = 0) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value)
}

function coveredRangeLabel(snapshot: ReportSnapshot, t: Messages, locale: string) {
  if (snapshot.period.range === 'all') {
    const boundaryEntries = [snapshot.feeds[0], snapshot.weights[0], snapshot.feeds.at(-1), snapshot.weights.at(-1)]
      .filter((entry): entry is Feed | Weight => entry !== undefined)
      .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt))
    const firstEntry = boundaryEntries[0]
    const lastEntry = boundaryEntries.at(-1)

    if (!firstEntry || !lastEntry) return t.reportAllRecordedData
    return `${t.reportAllRecordedData} — ${formatDateTime(firstEntry.occurredAt, locale)} → ${formatDateTime(lastEntry.occurredAt, locale)}`
  }

  if (snapshot.period.range === 'custom' && snapshot.period.startAt && snapshot.period.endAt) {
    return `${formatDate(snapshot.period.startAt, locale)} → ${formatDate(snapshot.period.endAt, locale)}`
  }

  if (!snapshot.period.startAt || !snapshot.period.endAt) return t.reportAllRecordedData
  return `${formatDateTime(snapshot.period.startAt, locale)} → ${formatDateTime(snapshot.period.endAt, locale)}`
}

function drawMetadataBlock(
  doc: {
    setFont: (fontName: string, fontStyle?: string) => void
    setFontSize: (size: number) => void
    setTextColor: (r: number, g: number, b: number) => void
    text: (text: string | string[], x: number, y: number, options?: { maxWidth?: number }) => void
    splitTextToSize: (text: string, size: number) => string[]
  },
  label: string,
  value: string,
  x: number,
  y: number,
  maxWidth: number,
) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(84, 96, 92)
  doc.text(label, x, y)

  const lines = doc.splitTextToSize(value, maxWidth)
  const valueY = y + META_VALUE_OFFSET

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(36, 51, 47)
  doc.text(lines, x, valueY)

  return valueY + (lines.length - 1) * META_LINE_HEIGHT
}

function addFooter(
  doc: {
    setPage: (page: number) => void
    getNumberOfPages: () => number
    internal: { pageSize: { getWidth: () => number; getHeight: () => number } }
    setFontSize: (size: number) => void
    setTextColor: (r: number, g: number, b: number) => void
    text: (text: string, x: number, y: number, options?: { align?: 'left' | 'right' | 'center' }) => void
  },
  t: Messages,
) {
  const totalPages = doc.getNumberOfPages()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  for (let page = 1; page <= totalPages; page++) {
    doc.setPage(page)
    doc.setFontSize(9)
    doc.setTextColor(120, 130, 126)
    doc.text(`${t.reportPage} ${page} ${t.reportOf} ${totalPages}`, pageWidth - PAGE_MARGIN, pageHeight - PAGE_FOOTER, {
      align: 'right',
    })
  }
}

function chartValueLabel(value: number, locale: string, suffix?: string) {
  return suffix ? `${formatNumber(value, locale)} ${suffix}` : formatNumber(value, locale)
}

export async function generateReportPdfBlob(snapshot: ReportSnapshot, t: Messages, locale: string) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])

  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const showComments = snapshot.config.includeComments
  const reportFeedChartPoints = compactReportFeedChartPoints(
    createReportFeedChartPoints(snapshot, locale),
    snapshot.period.range === '24h' ? 6 : 8,
  )
  let cursorY = PAGE_MARGIN

  const ensureSpace = (requiredHeight: number) => {
    if (cursorY + requiredHeight <= pageHeight - PAGE_MARGIN - PAGE_FOOTER - 30) return
    doc.addPage()
    cursorY = PAGE_MARGIN
  }

  const drawFeedChart = (
    title: string,
    points: ReportFeedChartPoint[],
    x: number,
    y: number,
    width: number,
    height: number,
    color: [number, number, number],
    valueForPoint: (point: ReportFeedChartPoint) => number,
    valueSuffix?: string,
  ) => {
    doc.setDrawColor(226, 232, 228)
    doc.rect(x, y, width, height)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(36, 51, 47)
    doc.text(title, x + CHART_CONTENT_SIDE, y + CHART_TITLE_OFFSET)

    if (points.length === 0) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(101, 115, 111)
      doc.text(t.reportNoFeeds, x + width / 2, y + height / 2, {
        align: 'center',
        maxWidth: width - CHART_CONTENT_SIDE * 2,
      })
      return
    }

    const maxValue = Math.max(...points.map(valueForPoint), 1)
    const plotLeft = x + CHART_CONTENT_SIDE
    const plotTop = y + CHART_CONTENT_TOP
    const plotBottom = y + height - CHART_CONTENT_BOTTOM
    const plotWidth = width - CHART_CONTENT_SIDE * 2
    const plotHeight = plotBottom - plotTop - CHART_LABEL_SPACE
    const barGap = Math.max(4, Math.min(10, plotWidth / Math.max(points.length * 4, 1)))
    const barWidth = Math.max(8, (plotWidth - barGap * (points.length + 1)) / Math.max(points.length, 1))
    const topValueY = plotTop - 6

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(84, 96, 92)
    doc.text(chartValueLabel(maxValue, locale, valueSuffix), x + width - CHART_CONTENT_SIDE, topValueY, {
      align: 'right',
    })
    doc.setDrawColor(226, 232, 228)
    doc.line(plotLeft, plotTop, plotLeft + plotWidth, plotTop)
    doc.line(plotLeft, plotBottom - CHART_LABEL_SPACE, plotLeft + plotWidth, plotBottom - CHART_LABEL_SPACE)

    points.forEach((point, index) => {
      const value = valueForPoint(point)
      const barHeight =
        value > 0 ? Math.max((value / maxValue) * (plotHeight - CHART_BAR_SCALE_PADDING), CHART_BAR_MIN_HEIGHT) : 0
      const barX = plotLeft + barGap + index * (barWidth + barGap)
      const barY = plotBottom - CHART_LABEL_SPACE - barHeight

      if (barHeight > 0) {
        doc.setFillColor(...color)
        doc.rect(barX, barY, barWidth, barHeight, 'F')
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)
        doc.setTextColor(84, 96, 92)
        doc.text(
          chartValueLabel(value, locale, valueSuffix),
          barX + barWidth / 2,
          Math.max(plotTop + CHART_BAR_VALUE_MIN_TOP, barY - CHART_BAR_VALUE_OFFSET),
          { align: 'center' },
        )
      }

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(84, 96, 92)
      doc.text(
        doc.splitTextToSize(point.label, barWidth + CHART_X_LABEL_WIDTH_PADDING).slice(0, CHART_X_LABEL_MAX_LINES),
        barX + barWidth / 2,
        plotBottom - CHART_X_LABEL_OFFSET,
        { align: 'center' },
      )
    })
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(36, 51, 47)
  doc.text(t.reportDocumentTitle, PAGE_MARGIN, cursorY)
  cursorY += 24

  doc.setFont('helvetica', 'normal')
  cursorY = drawMetadataBlock(
    doc,
    t.reportCoveredRange,
    coveredRangeLabel(snapshot, t, locale),
    PAGE_MARGIN,
    cursorY,
    pageWidth - PAGE_MARGIN * 2,
  ) + 10
  cursorY = drawMetadataBlock(
    doc,
    t.reportGeneratedAt,
    formatDateTime(snapshot.generatedAt, locale),
    PAGE_MARGIN,
    cursorY,
    pageWidth - PAGE_MARGIN * 2,
  ) + 18

  if (snapshot.config.includeFeeds) {
    ensureSpace(CHART_HEIGHT + 24)
    const chartWidth = (pageWidth - PAGE_MARGIN * 2 - CHART_GAP) / 2
    drawFeedChart(
      t.reportMilkQuantityChartTitle,
      reportFeedChartPoints,
      PAGE_MARGIN,
      cursorY,
      chartWidth,
      CHART_HEIGHT,
      CHART_COLOR_MILK,
      (point) => point.totalAmount,
      t.ml,
    )
    drawFeedChart(
      t.reportBottleCountChartTitle,
      reportFeedChartPoints,
      PAGE_MARGIN + chartWidth + CHART_GAP,
      cursorY,
      chartWidth,
      CHART_HEIGHT,
      CHART_COLOR_BOTTLES,
      (point) => point.bottleCount,
    )
    cursorY += CHART_HEIGHT + 24
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(36, 51, 47)
  doc.text(t.reportSummaryTitle, PAGE_MARGIN, cursorY)
  cursorY += 8

  const summaryRows: string[][] = []
  if (snapshot.config.includeFeeds) {
    summaryRows.push([t.reportFeedCount, formatNumber(snapshot.feedSummary.count, locale)])
    summaryRows.push([t.total, `${formatNumber(snapshot.feedSummary.totalAmount, locale)} ${t.ml}`])
    summaryRows.push([
      t.reportAverageQuantity,
      snapshot.feedSummary.averageAmount === null ? '—' : `${formatNumber(snapshot.feedSummary.averageAmount, locale, 1)} ${t.ml}`,
    ])
  }
  if (snapshot.config.includeWeights) {
    summaryRows.push([
      t.reportLatestWeightInPeriod,
      snapshot.latestWeight
        ? `${formatNumber(snapshot.latestWeight.kilograms, locale, 2)} ${t.kg} · ${formatDateTime(snapshot.latestWeight.occurredAt, locale)}`
        : '—',
    ])
  }
  if (summaryRows.length === 0) summaryRows.push([t.reportNoDataHeading, t.reportNoDataInRange])

  autoTable(doc, {
    startY: cursorY,
    theme: 'grid',
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN, bottom: TABLE_BOTTOM_MARGIN },
    body: summaryRows,
    styles: {
      fontSize: 10,
      cellPadding: 8,
      lineColor: [226, 232, 228],
      textColor: [36, 51, 47],
    },
    columnStyles: {
      0: { fontStyle: 'bold', fillColor: [248, 250, 247] },
    },
  })
  cursorY = ((doc as typeof doc & AutoTableDoc).lastAutoTable?.finalY ?? cursorY) + 24

  const sectionTitle = (title: string) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(36, 51, 47)
    doc.text(title, PAGE_MARGIN, cursorY)
    cursorY += 10
  }

  if (snapshot.config.includeFeeds) {
    sectionTitle(t.reportFeedsSectionTitle)
    if (snapshot.feeds.length > 0) {
      autoTable(doc, {
        startY: cursorY,
        theme: 'grid',
        margin: { left: PAGE_MARGIN, right: PAGE_MARGIN, bottom: TABLE_BOTTOM_MARGIN },
        head: [[t.reportDateTime, t.amount, ...(showComments ? [t.comment] : [])]],
        body: snapshot.feeds.map((feed) => [
          formatDateTime(feed.occurredAt, locale),
          `${formatNumber(feed.amount, locale)} ${t.ml}`,
          ...(showComments ? [feed.comment] : []),
        ]),
        styles: {
          fontSize: 10,
          cellPadding: 7,
          lineColor: [226, 232, 228],
        },
        headStyles: {
          fillColor: [236, 121, 108],
        },
      })
      cursorY = ((doc as typeof doc & AutoTableDoc).lastAutoTable?.finalY ?? cursorY) + 24
    } else {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(101, 115, 111)
      doc.text(t.reportNoFeeds, PAGE_MARGIN, cursorY)
      cursorY += 24
    }
  }

  if (snapshot.config.includeWeights) {
    sectionTitle(t.reportWeightsSectionTitle)
    if (snapshot.weights.length > 0) {
      autoTable(doc, {
        startY: cursorY,
        theme: 'grid',
        margin: { left: PAGE_MARGIN, right: PAGE_MARGIN, bottom: TABLE_BOTTOM_MARGIN },
        head: [[t.reportDateTime, t.weight]],
        body: snapshot.weights.map((weight) => [
          formatDateTime(weight.occurredAt, locale),
          `${formatNumber(weight.kilograms, locale, 2)} ${t.kg}`,
        ]),
        styles: {
          fontSize: 10,
          cellPadding: 7,
          lineColor: [226, 232, 228],
        },
        headStyles: {
          fillColor: [90, 156, 135],
        },
      })
      cursorY = ((doc as typeof doc & AutoTableDoc).lastAutoTable?.finalY ?? cursorY) + 24
    } else {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(101, 115, 111)
      doc.text(t.reportNoWeights, PAGE_MARGIN, cursorY)
      cursorY += 24
    }
  }

  const disclaimerText = doc.splitTextToSize(t.reportMedicalDisclaimer, pageWidth - PAGE_MARGIN * 2)
  const disclaimerHeight = disclaimerText.length * 10
  const disclaimerY = pageHeight - PAGE_FOOTER - 18

  if (cursorY + disclaimerHeight > disclaimerY) {
    doc.addPage()
  }

  doc.setPage(doc.getNumberOfPages())
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(9)
  doc.setTextColor(120, 130, 126)
  doc.text(disclaimerText, PAGE_MARGIN, pageHeight - PAGE_FOOTER - 18)

  addFooter(doc, t)
  return doc.output('blob')
}

export function downloadPdf(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
