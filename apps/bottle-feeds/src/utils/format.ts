// ---------------------------------------------------------------------------
// Locale-aware display formatting shared by the summary, trends and
// measure-history components.
// ---------------------------------------------------------------------------

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
