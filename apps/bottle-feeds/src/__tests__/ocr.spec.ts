import { describe, expect, it } from 'vitest'

import { parseFirstNumber } from '../ocr'

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
