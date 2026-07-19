<script setup lang="ts">
import { computed } from 'vue'
import { parseDate, type DateValue } from '@internationalized/date'
import UCalendar from '@nuxt/ui/components/Calendar.vue'
import UInputDate from '@nuxt/ui/components/InputDate.vue'
import UPopover from '@nuxt/ui/components/Popover.vue'

const props = defineProps<{
  id?: string
  locale: string
  min?: string
  max?: string
  required?: boolean
}>()

const value = defineModel<string>({ required: true })

function toDateValue(date?: string) {
  return date ? parseDate(date) : undefined
}

const dateValue = computed<DateValue | undefined>({
  get: () => toDateValue(value.value),
  set: (date) => {
    value.value = date?.toString() ?? ''
  },
})
const minValue = computed(() => toDateValue(props.min))
const maxValue = computed(() => toDateValue(props.max))
</script>

<template>
  <UPopover>
    <UInputDate
      :id="id"
      v-model="dateValue"
      class="localized-date-picker"
      data-date-picker
      :locale="locale"
      :min-value="minValue"
      :max-value="maxValue"
      :required="required"
    />

    <template #content>
      <UCalendar
        v-model="dateValue"
        class="p-2"
        :locale="locale"
        :min-value="minValue"
        :max-value="maxValue"
      />
    </template>
  </UPopover>
  <input v-model="value" type="hidden" data-date-value />
</template>
