import type { Messages } from '../i18n'
import type { Feed, Weight } from '../types'
import type { ReportSnapshot } from './logic'

const PAGE_MARGIN = 40
const PAGE_FOOTER = 28
const TABLE_MARGIN_BOTTOM = 36

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

export async function generateReportPdfBlob(snapshot: ReportSnapshot, t: Messages, locale: string) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])

  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const showComments = snapshot.config.includeComments
  let cursorY = PAGE_MARGIN

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(36, 51, 47)
  doc.text(t.reportDocumentTitle, PAGE_MARGIN, cursorY)
  cursorY += 24

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(84, 96, 92)
  doc.text(`${t.reportCoveredRange}: ${coveredRangeLabel(snapshot, t, locale)}`, PAGE_MARGIN, cursorY, {
    maxWidth: pageWidth - PAGE_MARGIN * 2,
  })
  cursorY += 16
  doc.text(`${t.reportGeneratedAt}: ${formatDateTime(snapshot.generatedAt, locale)}`, PAGE_MARGIN, cursorY)
  cursorY += 22

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
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN, bottom: TABLE_MARGIN_BOTTOM },
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
        margin: { left: PAGE_MARGIN, right: PAGE_MARGIN, bottom: TABLE_MARGIN_BOTTOM },
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
        margin: { left: PAGE_MARGIN, right: PAGE_MARGIN, bottom: TABLE_MARGIN_BOTTOM },
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
