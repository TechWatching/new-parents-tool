<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue'
import type { Messages } from '../i18n'
import { maskTimeInput, timePattern } from '../utils/time'

defineProps<{ t: Messages }>()
const emit = defineEmits<{ submit: [] }>()

const amount = defineModel<string>('amount', { required: true })
const date = defineModel<string>('date', { required: true })
const time = defineModel<string>('time', { required: true })
const comment = defineModel<string>('comment', { required: true })

// Masks free-form digits into `HH:MM` as the user types, keeping the caret in place.
function onTimeInput(event: Event) {
  maskTimeInput(event, (value) => {
    time.value = value
  })
}
</script>

<template>
  <form class="feed-card surface border-t-[3px] border-t-coral-500 p-5 sm:p-6" @submit.prevent="emit('submit')">
    <div class="flex items-center gap-2.5">
      <span
        class="grid size-8 place-items-center rounded-[10px] bg-coral-50 text-lg font-extrabold text-coral-600"
        aria-hidden="true"
      >＋</span>
      <h2 class="text-lg font-extrabold text-highlighted">{{ t.addFeed }}</h2>
    </div>
    <div class="mt-4 grid grid-cols-1 gap-3.5 sm:grid-cols-[1fr_1.4fr]">
      <label class="flex flex-col gap-2 text-sm font-semibold text-toned">
        {{ t.amount }}
        <input
          v-model="amount"
          class="field"
          type="number"
          min="1"
          max="2000"
          step="1"
          required
          inputmode="decimal"
        />
      </label>
      <label class="flex flex-col gap-2 text-sm font-semibold text-toned">
        {{ t.date }}
        <input v-model="date" class="field" type="date" required />
      </label>
      <label class="flex flex-col gap-2 text-sm font-semibold text-toned">
        {{ t.time }}
        <input
          :value="time"
          class="field"
          type="text"
          inputmode="numeric"
          :pattern="timePattern.source"
          placeholder="14:30"
          maxlength="5"
          required
          @input="onTimeInput"
        />
      </label>
      <label class="flex flex-col gap-2 text-sm font-semibold text-toned sm:col-span-2">
        {{ t.comment }}
        <input
          v-model="comment"
          class="field"
          type="text"
          maxlength="160"
          :placeholder="t.commentPlaceholder"
        />
      </label>
    </div>
    <UButton class="mt-5 font-semibold" type="submit" block size="lg">
      {{ t.saveFeed }}
    </UButton>
  </form>
</template>
