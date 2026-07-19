<script setup lang="ts">
import type { Messages } from '../i18n'
import { maskTimeInput, timePattern } from '../utils/time'
import LocalizedDatePicker from './LocalizedDatePicker.vue'

defineProps<{ t: Messages; locale: string }>()
const emit = defineEmits<{ submit: [] }>()

const kilograms = defineModel<string>('kilograms', { required: true })
const date = defineModel<string>('date', { required: true })
const time = defineModel<string>('time', { required: true })

// Masks free-form digits into `HH:MM` as the user types, keeping the caret in place.
function onTimeInput(event: Event) {
  maskTimeInput(event, (value) => {
    time.value = value
  })
}
</script>

<template>
  <form class="card form-card weight-card" @submit.prevent="emit('submit')">
    <div class="section-heading">
      <span class="icon mint" aria-hidden="true">↗</span>
      <h2>{{ t.addWeight }}</h2>
    </div>
    <label>
      {{ t.weight }}
      <input v-model="kilograms" type="number" min="0.1" max="50" step="0.01" required inputmode="decimal" />
    </label>
    <label>
      {{ t.date }}
      <LocalizedDatePicker v-model="date" :locale="locale" required />
    </label>
    <label>
      {{ t.time }}
      <input
        :value="time"
        type="text"
        inputmode="numeric"
        :pattern="timePattern.source"
        placeholder="14:30"
        maxlength="5"
        required
        @input="onTimeInput"
      />
    </label>
    <button class="secondary-button" type="submit">{{ t.saveWeight }}</button>
  </form>
</template>
