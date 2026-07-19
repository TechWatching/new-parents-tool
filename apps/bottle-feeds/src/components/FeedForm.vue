<script setup lang="ts">
import { computed } from 'vue'
import type { Messages } from '../i18n'
import { maskTimeValue, timePattern } from '../utils/time'

defineProps<{ t: Messages; locale: string }>()
const emit = defineEmits<{ submit: [] }>()

const amount = defineModel<string>('amount', { required: true })
const date = defineModel<string>('date', { required: true })
const time = defineModel<string>('time', { required: true })
const comment = defineModel<string>('comment', { required: true })

// Masks free-form digits into `HH:MM` as the user types, without mutating props directly.
const maskedTime = computed({
  get: () => time.value,
  set: (value: string) => {
    time.value = maskTimeValue(value)
  },
})
</script>

<template>
  <form class="card form-card feed-card" @submit.prevent="emit('submit')">
    <div class="section-heading">
      <span class="icon coral" aria-hidden="true">＋</span>
      <h2>{{ t.addFeed }}</h2>
    </div>
    <div class="form-grid">
      <label>
        {{ t.amount }}
        <input v-model="amount" type="number" min="1" max="2000" step="1" required inputmode="decimal" />
      </label>
      <label>
        {{ t.date }}
        <input v-model="date" type="date" :lang="locale" required />
      </label>
      <label>
        {{ t.time }}
        <input
          v-model="maskedTime"
          type="text"
          inputmode="numeric"
          :pattern="timePattern.source"
          placeholder="14:30"
          maxlength="5"
          required
        />
      </label>
      <label class="full-width">
        {{ t.comment }}
        <input v-model="comment" type="text" maxlength="160" :placeholder="t.commentPlaceholder" />
      </label>
    </div>
    <button class="primary-button" type="submit">{{ t.saveFeed }}</button>
  </form>
</template>
