import { nextTick } from 'vue'

// ---------------------------------------------------------------------------
// Date / time helpers shared by the feed & weight entry forms and history.
// ---------------------------------------------------------------------------

export const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/
export const LATEST_ENTRY_DATE_DURATION = 5 * 60 * 1000

export function showDatePicker(event: MouseEvent) {
  const input = event.currentTarget as HTMLInputElement
  input.showPicker?.()
}

/** Masks free-form digit input into a `HH:MM` shape as the user types. */
export function maskTimeValue(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 4)
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}:${digits.slice(2)}`
}

/** Finds the caret position in a masked `HH:MM` string right after a given number of digits. */
function cursorPositionForDigitCount(masked: string, digitCount: number) {
  let seen = 0
  for (let i = 0; i < masked.length; i++) {
    if (seen === digitCount) return i
    if (/\d/.test(masked.charAt(i))) seen++
  }
  return masked.length
}

/**
 * Handles a masked `HH:MM` text input's `input` event, applying `maskTimeValue`
 * while keeping the caret next to the digit the user just typed/deleted,
 * instead of letting it jump to the end of the field.
 */
export function maskTimeInput(event: Event, setValue: (value: string) => void) {
  const target = event.target as HTMLInputElement
  const cursor = target.selectionStart ?? target.value.length
  const digitsBeforeCursor = target.value.slice(0, cursor).replace(/\D/g, '').length
  const masked = maskTimeValue(target.value)
  setValue(masked)
  nextTick(() => {
    const position = cursorPositionForDigitCount(masked, digitsBeforeCursor)
    target.setSelectionRange(position, position)
  })
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
