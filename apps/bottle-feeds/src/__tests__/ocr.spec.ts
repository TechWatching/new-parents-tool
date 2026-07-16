import { describe, expect, it } from 'vite-plus/test'

import { parseFeedEntries, parseFirstNumber } from '../ocr'

describe('parseFirstNumber', () => {
  it('extracts an integer from surrounding text', () => {
    expect(parseFirstNumber('Bottle: 120 ml at 3pm')).toBe(120)
  })

  it('extracts a decimal number using a dot separator', () => {
    expect(parseFirstNumber('Weight 4.2 kg')).toBe(4.2)
  })

  it('extracts a decimal number using a comma separator', () => {
    expect(parseFirstNumber('Poids 4,2 kg')).toBe(4.2)
  })

  it('returns null when no number is found', () => {
    expect(parseFirstNumber('no digits here')).toBeNull()
  })

  it('returns null for a non-positive number', () => {
    expect(parseFirstNumber('0 ml')).toBeNull()
  })
})

describe('parseFeedEntries', () => {
  const reference = new Date('2024-03-10T00:00:00')

  it('parses several handwritten lines using different, non-uniform styles', () => {
    const text = ['1h45 -> 40', '8:30 - 120ml', '12h 90', '250'].join('\n')
    const entries = parseFeedEntries(text, reference)

    expect(entries).toHaveLength(4)

    expect(entries[0]!.amount).toBe(40)
    expect(new Date(entries[0]!.occurredAt).getHours()).toBe(1)
    expect(new Date(entries[0]!.occurredAt).getMinutes()).toBe(45)

    expect(entries[1]!.amount).toBe(120)
    expect(new Date(entries[1]!.occurredAt).getHours()).toBe(8)
    expect(new Date(entries[1]!.occurredAt).getMinutes()).toBe(30)

    expect(entries[2]!.amount).toBe(90)
    expect(new Date(entries[2]!.occurredAt).getHours()).toBe(12)

    expect(entries[3]!.amount).toBe(250)
  })

  it('supports 12-hour times written with am/pm', () => {
    const entries = parseFeedEntries('9am 60\n8:15pm 130', reference)

    expect(entries[0]!.amount).toBe(60)
    expect(new Date(entries[0]!.occurredAt).getHours()).toBe(9)

    expect(entries[1]!.amount).toBe(130)
    expect(new Date(entries[1]!.occurredAt).getHours()).toBe(20)
    expect(new Date(entries[1]!.occurredAt).getMinutes()).toBe(15)
  })

  it('handles noon and midnight correctly with am/pm', () => {
    const entries = parseFeedEntries('12pm 80\n12am 30', reference)

    expect(entries[0]!.amount).toBe(80)
    expect(new Date(entries[0]!.occurredAt).getHours()).toBe(12)

    expect(entries[1]!.amount).toBe(30)
    expect(new Date(entries[1]!.occurredAt).getHours()).toBe(0)
  })

  it('ignores blank lines and lines without a usable number', () => {
    const entries = parseFeedEntries('\n8h30\nnote: fussy\n\n70', reference)

    expect(entries).toHaveLength(1)
    expect(entries[0]!.amount).toBe(70)
  })

  it('returns an empty array when nothing is readable', () => {
    expect(parseFeedEntries('no digits here', reference)).toEqual([])
  })

  it('ignores date-header lines so they are not mistaken for entries', () => {
    const text = [
      '14/07 3,480',
      '19h45 -> 40',
      '21h45 -> 10',
      '',
      '16/07',
      '',
      '3h15 -> 35',
      '9h05 -> 50',
    ].join('\n')

    const entries = parseFeedEntries(text, reference)

    expect(entries).toHaveLength(4)
    expect(entries[0]!.amount).toBe(40)
    expect(entries[1]!.amount).toBe(10)
    expect(entries[2]!.amount).toBe(35)
    expect(entries[3]!.amount).toBe(50)
  })

  it('assigns entries to the date from the most recent date-header line', () => {
    const text = ['14/07 3,480', '19h45 -> 40', '21h45 -> 10', '16/07', '3h15 -> 35'].join('\n')

    const entries = parseFeedEntries(text, reference)

    expect(new Date(entries[0]!.occurredAt).getMonth()).toBe(6) // July (0-indexed)
    expect(new Date(entries[0]!.occurredAt).getDate()).toBe(14)
    expect(new Date(entries[1]!.occurredAt).getDate()).toBe(14)
    expect(new Date(entries[2]!.occurredAt).getDate()).toBe(16)
  })

  it('rolls over to the next day when a time is earlier than the previous one', () => {
    const text = [
      '14/07',
      '19h45 -> 40',
      '21h45 -> 10',
      '23h30 -> 50',
      '1h45 -> 10',
      '3h45 -> 30',
    ].join('\n')

    const entries = parseFeedEntries(text, reference)

    expect(entries).toHaveLength(5)
    expect(new Date(entries[0]!.occurredAt).getDate()).toBe(14)
    expect(new Date(entries[2]!.occurredAt).getDate()).toBe(14)
    // "1h45" comes after "23h30", so it must roll over to the next day.
    expect(new Date(entries[3]!.occurredAt).getDate()).toBe(15)
    expect(new Date(entries[3]!.occurredAt).getHours()).toBe(1)
    expect(new Date(entries[4]!.occurredAt).getDate()).toBe(15)
  })

  it('ignores an invalid calendar date (e.g. day out of range for the month)', () => {
    const text = ['31/02', '8h30 -> 40'].join('\n')

    const entries = parseFeedEntries(text, reference)
    const feedEntry = entries.find((entry) => entry.amount === 40)

    expect(feedEntry).toBeDefined()
    expect(new Date(feedEntry!.occurredAt).getMonth()).toBe(reference.getMonth())
    expect(new Date(feedEntry!.occurredAt).getDate()).toBe(reference.getDate())
  })

  it('advances the year when a date header without an explicit year moves backwards (e.g. New Year)', () => {
    const dec31 = new Date('2024-12-31T00:00:00')
    const text = ['31/12', '22h -> 40', '01/01', '2h -> 30'].join('\n')

    const entries = parseFeedEntries(text, dec31)

    expect(new Date(entries[0]!.occurredAt).getFullYear()).toBe(2024)
    expect(new Date(entries[0]!.occurredAt).getMonth()).toBe(11)
    expect(new Date(entries[0]!.occurredAt).getDate()).toBe(31)

    expect(new Date(entries[1]!.occurredAt).getFullYear()).toBe(2025)
    expect(new Date(entries[1]!.occurredAt).getMonth()).toBe(0)
    expect(new Date(entries[1]!.occurredAt).getDate()).toBe(1)
  })

  it('interprets a two-digit year using the standard pivot (00-68 -> 20xx, 69-99 -> 19xx)', () => {
    const text = ['14/07/24', '8h -> 40', '14/07/95', '9h -> 30'].join('\n')

    const entries = parseFeedEntries(text, reference)

    expect(new Date(entries[0]!.occurredAt).getFullYear()).toBe(2024)
    expect(new Date(entries[1]!.occurredAt).getFullYear()).toBe(1995)
  })

  it('reproduces the reported multi-day handwritten log with correct dates', () => {
    const text = [
      '14/07 3,480',
      '19h45 -> 40',
      '21h45 -> 10',
      '23h30 -> 50',
      '1h45 -> 10',
      '3h45 -> 30',
      '7h -> 40',
      '9h45 -> 35',
      '12h30 -> 45',
      '14h44 -> 40',
      '17h30 -> 50',
      '20h30 -> 40',
      '22h30 -> 25',
      '',
      '16/07',
      '',
      '3h15 -> 35',
      '9h05 -> 50',
      '10h45 -> 30',
      '13h30 -> 45',
    ].join('\n')

    const entries = parseFeedEntries(text, reference)

    expect(entries).toHaveLength(16)

    const dates = entries.map((entry) => new Date(entry.occurredAt).getDate())
    expect(dates.slice(0, 3)).toEqual([14, 14, 14])
    expect(dates.slice(3, 12)).toEqual(Array(9).fill(15))
    expect(dates.slice(12)).toEqual(Array(4).fill(16))
  })
})
