import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from '../utils/format'

describe('formatRelativeTime', () => {
  const now = Date.parse('2024-01-01T12:00:00Z')

  it('formats in English when locale is en-GB', () => {
    const value = new Date(now - 2 * 60 * 60 * 1000).toISOString()
    expect(formatRelativeTime(value, 'en-GB', now)).toBe('2 hours')
  })

  it('formats in French when locale is fr-FR', () => {
    const value = new Date(now - 2 * 60 * 60 * 1000).toISOString()
    expect(formatRelativeTime(value, 'fr-FR', now)).toBe('2 heures')
  })

  it('uses singular French unit for a single hour', () => {
    const value = new Date(now - 60 * 60 * 1000).toISOString()
    expect(formatRelativeTime(value, 'fr-FR', now)).toBe('1 heure')
  })

  it('combines hours and minutes in French', () => {
    const value = new Date(now - (2 * 60 * 60 + 5 * 60) * 1000).toISOString()
    expect(formatRelativeTime(value, 'fr-FR', now)).toBe('2 heures et 5 minutes')
  })

  it('formats days in French', () => {
    const value = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString()
    expect(formatRelativeTime(value, 'fr-FR', now)).toBe('3 jours')
  })

  it('returns "maintenant" for very recent times in French', () => {
    const value = new Date(now - 10 * 1000).toISOString()
    expect(formatRelativeTime(value, 'fr-FR', now)).toBe('maintenant')
  })

  it('returns "now" for very recent times in English', () => {
    const value = new Date(now - 10 * 1000).toISOString()
    expect(formatRelativeTime(value, 'en-GB', now)).toBe('now')
  })

  it('uses singular English unit for a single hour', () => {
    const value = new Date(now - 60 * 60 * 1000).toISOString()
    expect(formatRelativeTime(value, 'en-GB', now)).toBe('1 hour')
  })

  it('uses singular English unit for a single minute', () => {
    const value = new Date(now - 60 * 1000).toISOString()
    expect(formatRelativeTime(value, 'en-GB', now)).toBe('1 minute')
  })

  it('combines hours and minutes in English', () => {
    const value = new Date(now - (2 * 60 * 60 + 5 * 60) * 1000).toISOString()
    expect(formatRelativeTime(value, 'en-GB', now)).toBe('2 hours and 5 minutes')
  })

  it('formats days in English', () => {
    const value = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString()
    expect(formatRelativeTime(value, 'en-GB', now)).toBe('3 days')
  })

  it('does not treat a locale merely starting with "fr" (e.g. Frisian) as French', () => {
    const value = new Date(now - 2 * 60 * 60 * 1000).toISOString()
    expect(formatRelativeTime(value, 'fry-NL', now)).toBe('2 hours')
  })
})
