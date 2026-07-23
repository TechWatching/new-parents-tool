// ---------------------------------------------------------------------------
// Locale-aware display formatting shared by the summary, trends and
// measure-history components.
// ---------------------------------------------------------------------------

const NOW_DISPLAY_THRESHOLD_SECONDS = 45

type DurationUnit = 'second' | 'minute' | 'hour' | 'day'

type RelativeTimeStrings = {
  now: string
  and: string
  unit: (value: number, unit: DurationUnit) => string
}

const RELATIVE_TIME_STRINGS: Record<'en' | 'fr', RelativeTimeStrings> = {
  en: {
    now: 'now',
    and: 'and',
    unit: (value, unit) => `${value} ${unit}${value === 1 ? '' : 's'}`,
  },
  fr: {
    now: 'maintenant',
    and: 'et',
    unit: (value, unit) => {
      const labels: Record<DurationUnit, [string, string]> = {
        second: ['seconde', 'secondes'],
        minute: ['minute', 'minutes'],
        hour: ['heure', 'heures'],
        day: ['jour', 'jours'],
      }
      const [singular, plural] = labels[unit]
      return `${value} ${value === 1 ? singular : plural}`
    },
  },
}

function stringsFor(locale: string): RelativeTimeStrings {
  const language = locale.toLowerCase().split('-')[0]
  return language === 'fr' ? RELATIVE_TIME_STRINGS.fr : RELATIVE_TIME_STRINGS.en
}

/** True while the elapsed time since `value` is still within the "now" display threshold. */
export function isRelativeTimeNow(value: string, now = Date.now()) {
  const elapsedMilliseconds = Math.max(0, now - Date.parse(value))
  return Math.floor(elapsedMilliseconds / 1000) < NOW_DISPLAY_THRESHOLD_SECONDS
}

export function formatRelativeTime(value: string, locale: string, now = Date.now()) {
  const strings = stringsFor(locale)
  const elapsedMilliseconds = Math.max(0, now - Date.parse(value))
  const seconds = Math.floor(elapsedMilliseconds / 1000)

  if (seconds < NOW_DISPLAY_THRESHOLD_SECONDS) return strings.now
  if (seconds < 60) return strings.unit(seconds, 'second')

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return strings.unit(minutes, 'minute')

  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    const remainingMinutes = minutes % 60
    if (remainingMinutes === 0) return strings.unit(hours, 'hour')
    return `${strings.unit(hours, 'hour')} ${strings.and} ${strings.unit(remainingMinutes, 'minute')}`
  }

  const days = Math.floor(hours / 24)
  return strings.unit(days, 'day')
}

export function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function formatDateOnly(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
  }).format(new Date(value))
}

export function shortDay(date: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date)
}
