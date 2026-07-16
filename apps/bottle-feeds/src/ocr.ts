import Tesseract from 'tesseract.js'
// Bundled locally (instead of relying on Tesseract's jsDelivr CDN default) so
// scanning still works when the CDN is unreachable or blocked (offline, ad
// blockers, restrictive CSPs, etc.), which was causing the photo scan to
// always fail for some users.
import workerPath from 'tesseract.js/dist/worker.min.js?url'

/**
 * Runs on-device text recognition on an image (e.g. a photo of a handwritten
 * note or a bottle/scale display) and returns the recognized text.
 */
export async function extractTextFromImage(image: Blob | File): Promise<string> {
  const { data } = await Tesseract.recognize(image, 'eng', { workerPath })
  return data.text
}

/**
 * Extracts the first decimal number found in a piece of text, accepting
 * both `.` and `,` as decimal separators.
 */
export function parseFirstNumber(text: string): number | null {
  const match = text.match(/\d+(?:[.,]\d+)?/)
  if (!match) return null

  const value = Number(match[0].replace(',', '.'))
  return Number.isFinite(value) && value > 0 ? value : null
}

/** A time of day extracted from a handwritten line, e.g. `1h45`, `8:30`, `9am`. */
interface ExtractedTime {
  hours: number
  minutes: number
  start: number
  end: number
}

/**
 * Matches a time-of-day token, trying the most specific (and least
 * ambiguous) formats first so a bare number is never mistaken for minutes.
 */
const TIME_EXTRACTORS: Array<{
  regex: RegExp
  toTime: (match: RegExpExecArray) => { hours: number; minutes: number }
}> = [
  // 24h with attached minutes, no space: "1h45", "13h20", "08h05"
  {
    regex: /\b([01]?\d|2[0-3])h([0-5]\d)\b/i,
    toTime: (match) => ({ hours: Number(match[1]), minutes: Number(match[2]) }),
  },
  // 24h with colon, no letters right after: "8:30", "13:05"
  {
    regex: /\b([01]?\d|2[0-3]):([0-5]\d)\b/,
    toTime: (match) => ({ hours: Number(match[1]), minutes: Number(match[2]) }),
  },
  // 12h with am/pm, minutes optional: "9am", "8:15pm"
  {
    regex: /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/i,
    toTime: (match) => {
      // `% 12` maps 12 -> 0, so "12am" is midnight (0). For "pm", adding 12
      // to that result gives 12 (noon) for "12pm" and 13-23 for 1-11pm.
      const hours = Number(match[1]) % 12
      return {
        hours: match[3]?.toLowerCase() === 'pm' ? hours + 12 : hours,
        minutes: match[2] ? Number(match[2]) : 0,
      }
    },
  },
  // 24h hour only, no minutes: "13h", "8h"
  {
    regex: /\b([01]?\d|2[0-3])h\b/i,
    toTime: (match) => ({ hours: Number(match[1]), minutes: 0 }),
  },
]

function extractTime(line: string): ExtractedTime | null {
  for (const { regex, toTime } of TIME_EXTRACTORS) {
    const match = regex.exec(line)
    if (!match) continue

    const { hours, minutes } = toTime(match)
    return { hours, minutes, start: match.index, end: match.index + match[0].length }
  }
  return null
}

/** A single bottle entry recognized from one line of a handwritten note. */
export interface ParsedFeedEntry {
  amount: number
  occurredAt: string
}

/**
 * Matches a line that starts with a day/month date, e.g. `14/07`, `16/07`
 * or `14/07/2024`, optionally followed by other values (such as a weight
 * measurement written on the same line). Handwritten logs often use such a
 * line as a day separator/header for the entries that follow, so it must be
 * captured (to advance the current day) rather than mistaken for a time
 * and/or an amount. The day/month groups are restricted to plausible
 * calendar ranges (01-31 / 01-12) to avoid matching unrelated numbers.
 */
const DATE_LINE = /^(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[0-2])(?:\/(\d{2,4}))?\b/

/** A day/month(/year) date extracted from a handwritten date-header line. */
interface ExtractedDate {
  day: number
  month: number
  year?: number
}

/** Number of days in `month` (1-12) for `year`, accounting for leap years. */
function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate()
}

function extractDateHeader(line: string, referenceYear: number): ExtractedDate | null {
  const match = DATE_LINE.exec(line)
  if (!match) return null

  const day = Number(match[1])
  const month = Number(match[2])
  const yearText = match[3]
  const yearNumber = yearText ? Number(yearText) : undefined
  // Two-digit years use the common pivot convention: 00-68 -> 2000-2068,
  // 69-99 -> 1969-1999 (matching e.g. POSIX strptime's "%y" behavior).
  const year =
    yearNumber === undefined
      ? undefined
      : yearText!.length === 2
        ? (yearNumber <= 68 ? 2000 : 1900) + yearNumber
        : yearNumber

  // Reject dates like "31/02" that don't exist in the given (or reference)
  // year, rather than letting them silently roll over into the next month.
  if (day > daysInMonth(month, year ?? referenceYear)) return null

  return { day, month, year }
}

/**
 * Parses multiple handwritten lines that may each use a different style
 * (e.g. `1h45 -> 40`, `8:30 - 120ml`, `12h 90`, or just `250`). Notes often
 * span several days: a date-header line (e.g. `14/07`) sets the day for the
 * entries that follow, until the next date header. Within a day's entries,
 * a time that is earlier than the previous one (e.g. `23h30` followed by
 * `1h45`) is assumed to have rolled over past midnight into the next day.
 * Every other line is handled independently: a time-of-day token is
 * detected and removed first (to avoid confusing it with the quantity),
 * then the first remaining number is taken as the amount. Lines without a
 * usable number are skipped.
 */
export function parseFeedEntries(text: string, referenceDate = new Date()): ParsedFeedEntry[] {
  const entries: ParsedFeedEntry[] = []

  const currentDate = new Date(referenceDate)
  currentDate.setHours(0, 0, 0, 0)
  let previousMinutesOfDay: number | null = null

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    const dateHeader = extractDateHeader(line, currentDate.getFullYear())
    if (dateHeader) {
      if (dateHeader.year !== undefined) {
        // Setting year, month and day together avoids ever passing through
        // an invalid intermediate date. For example, calling `setMonth(1, 29)`
        // first while `currentDate` is still in a leap year, then calling
        // `setFullYear` to a non-leap year, would silently normalize "Feb 29"
        // to "Mar 1" instead of landing on the intended date.
        currentDate.setFullYear(dateHeader.year, dateHeader.month - 1, dateHeader.day)
      } else {
        // No explicit year: keep the current one, unless that would move
        // the date backwards (e.g. a "31/12" header followed by "01/01"
        // with no year), in which case the log has crossed into next year.
        const candidate = new Date(currentDate)
        candidate.setMonth(dateHeader.month - 1, dateHeader.day)
        if (candidate.getTime() < currentDate.getTime()) {
          candidate.setFullYear(candidate.getFullYear() + 1)
        }
        currentDate.setTime(candidate.getTime())
      }
      previousMinutesOfDay = null
      continue
    }

    const time = extractTime(line)
    const remainder = time ? line.slice(0, time.start) + ' ' + line.slice(time.end) : line
    const amount = parseFirstNumber(remainder)
    if (amount === null) continue

    if (time) {
      const minutesOfDay = time.hours * 60 + time.minutes
      if (previousMinutesOfDay !== null && minutesOfDay < previousMinutesOfDay) {
        currentDate.setDate(currentDate.getDate() + 1)
      }
      previousMinutesOfDay = minutesOfDay
    }

    const occurredAt = new Date(currentDate)
    if (time) {
      occurredAt.setHours(time.hours, time.minutes, 0, 0)
    }
    entries.push({ amount, occurredAt: occurredAt.toISOString() })
  }

  return entries
}
