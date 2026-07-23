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
  <form class="feed-card border border-border-light rounded-[18px] bg-white shadow-[0_5px_22px_rgba(45,72,62,0.05)] p-5 border-t-3 border-t-coral" @submit.prevent="emit('submit')">
    <div class="flex items-center gap-2.5">
      <span class="grid place-items-center w-[30px] h-[30px] rounded-[10px] text-[#d95f52] bg-[#fff0ed] font-extrabold" aria-hidden="true">＋</span>
      <h2 class="m-0 text-[19px] font-extrabold">{{ t.addFeed }}</h2>
    </div>
    <div class="grid grid-cols-[1fr_1.4fr] gap-3.5 mt-4 max-sm:grid-cols-1">
      <label class="flex flex-col gap-1.5 text-[#56635f] text-[13px] font-semibold">
        {{ t.amount }}
        <input v-model="amount" type="number" min="1" max="2000" step="1" required inputmode="decimal" class="w-full border border-[#d9e1dd] rounded-[10px] px-3 py-2.5 text-text-primary bg-[#fbfcfb] outline-none transition-all focus:border-focus focus:ring-3 focus:ring-focus-ring focus:bg-white" />
      </label>
      <label class="flex flex-col gap-1.5 text-[#56635f] text-[13px] font-semibold">
        {{ t.date }}
        <input v-model="date" type="date" required class="w-full border border-[#d9e1dd] rounded-[10px] px-3 py-2.5 text-text-primary bg-[#fbfcfb] outline-none transition-all focus:border-focus focus:ring-3 focus:ring-focus-ring focus:bg-white" />
      </label>
      <label class="flex flex-col gap-1.5 text-[#56635f] text-[13px] font-semibold">
        {{ t.time }}
        <input
          :value="time"
          type="text"
          inputmode="numeric"
          :pattern="timePattern.source"
          placeholder="14:30"
          maxlength="5"
          required
          class="w-full border border-[#d9e1dd] rounded-[10px] px-3 py-2.5 text-text-primary bg-[#fbfcfb] outline-none transition-all focus:border-focus focus:ring-3 focus:ring-focus-ring focus:bg-white"
          @input="onTimeInput"
        />
      </label>
      <label class="col-span-full flex flex-col gap-1.5 text-[#56635f] text-[13px] font-semibold max-sm:col-auto">
        {{ t.comment }}
        <input v-model="comment" type="text" maxlength="160" :placeholder="t.commentPlaceholder" class="w-full border border-[#d9e1dd] rounded-[10px] px-3 py-2.5 text-text-primary bg-[#fbfcfb] outline-none transition-all focus:border-focus focus:ring-3 focus:ring-focus-ring focus:bg-white" />
      </label>
    </div>
    <UButton class="w-full mt-4 justify-center rounded-[11px] font-bold shadow-[0_2px_6px_rgba(45,72,62,0.12)] hover:shadow-[0_5px_12px_rgba(220,104,93,0.24)] hover:-translate-y-px transition-all" type="submit" color="error">{{ t.saveFeed }}</UButton>
  </form>
</template>
