import { describe, expect, it } from 'vitest'

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
})
