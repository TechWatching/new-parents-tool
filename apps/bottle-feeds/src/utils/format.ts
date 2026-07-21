// ---------------------------------------------------------------------------
// Locale-aware display formatting shared by the summary, trends and
// measure-history components.
// ---------------------------------------------------------------------------

const NOW_DISPLAY_THRESHOLD_SECONDS = 45

function formatDurationUnit(value: number, unit: 'second' | 'minute' | 'hour' | 'day') {
  return `${value} ${unit}${value === 1 ? '' : 's'}`
}

export function formatRelativeTime(value: string, _locale: string, now = Date.now()) {
  const elapsedMilliseconds = Math.max(0, now - Date.parse(value))
  const seconds = Math.floor(elapsedMilliseconds / 1000)

  if (seconds < NOW_DISPLAY_THRESHOLD_SECONDS) return 'now'
  if (seconds < 60) return formatDurationUnit(seconds, 'second')

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return formatDurationUnit(minutes, 'minute')

  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    const remainingMinutes = minutes % 60
    if (remainingMinutes === 0) return formatDurationUnit(hours, 'hour')
    return `${formatDurationUnit(hours, 'hour')} and ${formatDurationUnit(remainingMinutes, 'minute')}`
  }

  const days = Math.floor(hours / 24)
  return formatDurationUnit(days, 'day')
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
