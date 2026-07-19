// ---------------------------------------------------------------------------
// Date / time helpers shared by the feed & weight entry forms and history.
// ---------------------------------------------------------------------------

export const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/
export const LATEST_ENTRY_DATE_DURATION = 5 * 60 * 1000

/** Masks free-form digit input into a `HH:MM` shape as the user types. */
export function maskTimeValue(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 4)
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}:${digits.slice(2)}`
}

export function nowForInput() {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

export function dateTimeForInput() {
  const value = nowForInput()
  return { date: value.slice(0, 10), time: value.slice(11) }
}

export function occurredAt(date: string, time: string) {
  if (!timePattern.test(time)) return null
  const value = new Date(`${date}T${time}`)
  return Number.isNaN(value.getTime()) ? null : value.toISOString()
}

export function dateOnlyOccurredAt(date: string) {
  const value = new Date(`${date}T00:00`)
  return Number.isNaN(value.getTime()) ? null : value.toISOString()
}

export function dateTimeFromOccurredAt(value: string) {
  const date = new Date(value)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  const localValue = date.toISOString().slice(0, 16)
  return { date: localValue.slice(0, 10), time: localValue.slice(11) }
}

export function dateFromOccurredAt(value: string) {
  return dateTimeFromOccurredAt(value).date
}
