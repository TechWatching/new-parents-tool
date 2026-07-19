<script setup lang="ts">
// A locale-aware replacement for `<input type="date">`. Native date inputs render
// their calendar picker using the browser/OS language, ignoring the page's `lang`
// attribute — so the picker never followed this app's English/French toggle. This
// component instead pairs a masked text field (for typing, like the time inputs)
// with a calendar popup rendered by `@nuxt/ui`'s `UCalendar` (backed by
// `@internationalized/date`), whose language is driven directly by the `locale`
// prop rather than the browser's settings.
import { computed, ref, watch } from 'vue'
import { parseDate, type DateValue } from '@internationalized/date'
import UPopover from '@nuxt/ui/components/Popover.vue'
import UCalendar from '@nuxt/ui/components/Calendar.vue'
import { displayDateToIso, isoDateToDisplay, maskDateValue } from '../utils/time'

const props = defineProps<{
  locale: string
  id?: string
  required?: boolean
  min?: string
  max?: string
}>()

const value = defineModel<string>({ required: true })
const open = ref(false)
const displayValue = ref(isoDateToDisplay(value.value))

// Keep the text buffer in sync when the ISO value changes from elsewhere
// (calendar selection, five-minute default reset, edit form prefill, etc.).
// Skip reformatting while the incoming value is just an echo of what `onInput`
// itself produced (e.g. a still-incomplete date being typed), otherwise the
// round trip through the parent's v-model would erase what the user is typing.
watch(value, (next) => {
  if ((displayDateToIso(displayValue.value) ?? '') === (next ?? '')) return
  displayValue.value = isoDateToDisplay(next)
})

function onInput(event: Event) {
  const masked = maskDateValue((event.target as HTMLInputElement).value)
  displayValue.value = masked
  value.value = displayDateToIso(masked) ?? ''
}

function toCalendarDate(iso: string | undefined): DateValue | undefined {
  if (!iso) return undefined
  try {
    return parseDate(iso)
  } catch {
    return undefined
  }
}

const calendarValue = computed(() => toCalendarDate(value.value))
const minValue = computed(() => toCalendarDate(props.min))
const maxValue = computed(() => toCalendarDate(props.max))

const isFrench = computed(() => props.locale.toLowerCase().startsWith('fr'))
const placeholder = computed(() => (isFrench.value ? 'JJ/MM/AAAA' : 'DD/MM/YYYY'))
const toggleLabel = computed(() => (isFrench.value ? 'Choisir une date' : 'Choose a date'))

function isDateValue(next: unknown): next is DateValue {
  return (
    !!next &&
    typeof next === 'object' &&
    !Array.isArray(next) &&
    'year' in next &&
    'month' in next &&
    'day' in next &&
    typeof (next as DateValue).toString === 'function'
  )
}

function selectDate(next: unknown) {
  if (isDateValue(next)) {
    value.value = next.toString()
  }
  open.value = false
}
</script>

<template>
  <div class="date-field">
    <input
      :id="id"
      type="text"
      inputmode="numeric"
      class="date-field-input"
      :placeholder="placeholder"
      maxlength="10"
      :required="required"
      :value="displayValue"
      :data-iso="value"
      @input="onInput"
    />
    <UPopover v-model:open="open">
      <button type="button" class="date-field-toggle" :aria-label="toggleLabel">
        <span aria-hidden="true">📅</span>
      </button>
      <template #content>
        <UCalendar
          :model-value="calendarValue"
          :locale="locale"
          :min-value="minValue"
          :max-value="maxValue"
          class="date-field-calendar"
          @update:model-value="selectDate"
        />
      </template>
    </UPopover>
  </div>
</template>
