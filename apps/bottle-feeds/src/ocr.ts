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
 * line as a day separator/header, not as a feed entry, so it must be
 * skipped entirely rather than mistaken for a time and/or an amount.
 */
const DATE_LINE = /^\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/

/**
 * Parses multiple handwritten lines that may each use a different style
 * (e.g. `1h45 -> 40`, `8:30 - 120ml`, `12h 90`, or just `250`). Every line is
 * handled independently: a time-of-day token is detected and removed first
 * (to avoid confusing it with the quantity), then the first remaining
 * number is taken as the amount. Lines without a usable number, and
 * date-header lines, are skipped.
 */
export function parseFeedEntries(text: string, referenceDate = new Date()): ParsedFeedEntry[] {
  const entries: ParsedFeedEntry[] = []

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || DATE_LINE.test(line)) continue

    const time = extractTime(line)
    const remainder = time ? line.slice(0, time.start) + ' ' + line.slice(time.end) : line
    const amount = parseFirstNumber(remainder)
    if (amount === null) continue

    const occurredAt = new Date(referenceDate)
    if (time) {
      occurredAt.setHours(time.hours, time.minutes, 0, 0)
    }
    entries.push({ amount, occurredAt: occurredAt.toISOString() })
  }

  return entries
}
