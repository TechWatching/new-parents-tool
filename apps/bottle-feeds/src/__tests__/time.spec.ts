import { describe, expect, it, vi } from 'vite-plus/test'
import { nextTick } from 'vue'
import { maskTimeInput, maskTimeValue, showDatePicker } from '../utils/time'

function makeInputEvent(value: string, selectionStart: number) {
  const input = document.createElement('input')
  document.body.append(input)
  input.value = value
  input.setSelectionRange(selectionStart, selectionStart)
  return { input, event: { target: input } as unknown as Event }
}

describe('maskTimeValue', () => {
  it('inserts the colon after two digits', () => {
    expect(maskTimeValue('1234')).toBe('12:34')
    expect(maskTimeValue('12')).toBe('12')
  })

  describe('showDatePicker', () => {
    it('opens the native picker for the clicked date input', () => {
      const input = document.createElement('input')
      input.type = 'date'
      input.showPicker = vi.fn()

      showDatePicker({ currentTarget: input } as unknown as MouseEvent)

      expect(input.showPicker).toHaveBeenCalledOnce()
    })
  })
})

describe('maskTimeInput', () => {
  it('keeps the caret right after a digit inserted in the middle of the value', async () => {
    // Existing value "12:34", user places the caret between "2" and ":" then types "9",
    // which the browser turns into "129:34" with the caret after the new "9" (index 3).
    const { input, event } = makeInputEvent('129:34', 3)

    let value = ''
    maskTimeInput(event, (v) => {
      value = v
      input.value = v // simulate Vue re-rendering the bound `:value` after the model update
    })
    await nextTick()

    expect(value).toBe('12:93')
    expect(input.selectionStart).toBe(4)
  })

  it('keeps the caret in place when deleting a digit in the middle of the value', async () => {
    // Existing value "12:34", user deletes the "2", browser produces "1:34" with caret at index 1.
    const { input, event } = makeInputEvent('1:34', 1)

    let value = ''
    maskTimeInput(event, (v) => {
      value = v
      input.value = v
    })
    await nextTick()

    expect(value).toBe('13:4')
    expect(input.selectionStart).toBe(1)
  })

  it('leaves the caret at the end when typing at the end of the value', async () => {
    const { input, event } = makeInputEvent('123', 3)

    let value = ''
    maskTimeInput(event, (v) => {
      value = v
      input.value = v
    })
    await nextTick()

    expect(value).toBe('12:3')
    expect(input.selectionStart).toBe(4)
  })
})
