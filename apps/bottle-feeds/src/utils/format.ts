// ---------------------------------------------------------------------------
// Locale-aware display formatting shared by the summary, trends and
// measure-history components.
// ---------------------------------------------------------------------------

const NOW_DISPLAY_THRESHOLD_SECONDS = 45

export function formatRelativeTime(value: string, locale: string, now = Date.now()) {
  const elapsedMilliseconds = Math.max(0, now - Date.parse(value))
  const seconds = Math.floor(elapsedMilliseconds / 1000)
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

  if (seconds < NOW_DISPLAY_THRESHOLD_SECONDS) return formatter.format(0, 'second')
  if (seconds < 60) return formatter.format(-seconds, 'second')

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return formatter.format(-minutes, 'minute')

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return formatter.format(-hours, 'hour')

  const days = Math.floor(hours / 24)
  return formatter.format(-days, 'day')
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
