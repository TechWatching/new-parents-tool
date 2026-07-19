// ---------------------------------------------------------------------------
// Date / time helpers shared by the feed & weight entry forms and history.
// ---------------------------------------------------------------------------

export const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/
export const displayDatePattern = /^\d{2}\/\d{2}\/\d{4}$/
export const LATEST_ENTRY_DATE_DURATION = 5 * 60 * 1000

/** Masks free-form digit input into a `HH:MM` shape as the user types. */
export function maskTimeValue(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 4)
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}:${digits.slice(2)}`
}

/** Masks free-form digit input into a `DD/MM/YYYY` shape as the user types. */
export function maskDateValue(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

/** Converts a `DD/MM/YYYY` display string into an ISO `YYYY-MM-DD` date, or `null` if invalid. */
export function displayDateToIso(display: string): string | null {
  const match = displayDatePattern.exec(display)
  if (!match) return null
  const day = Number(display.slice(0, 2))
  const month = Number(display.slice(3, 5))
  const year = Number(display.slice(6, 10))
  if (month < 1 || month > 12) return null
  const daysInMonth = new Date(year, month, 0).getDate()
  if (day < 1 || day > daysInMonth) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)}`
}

/** Converts an ISO `YYYY-MM-DD` date into a `DD/MM/YYYY` display string, or `''` if empty/invalid. */
export function isoDateToDisplay(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ''
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
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

export function dateTimeFromOccurredAt(value: string) {
  const date = new Date(value)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  const localValue = date.toISOString().slice(0, 16)
  return { date: localValue.slice(0, 10), time: localValue.slice(11) }
}
