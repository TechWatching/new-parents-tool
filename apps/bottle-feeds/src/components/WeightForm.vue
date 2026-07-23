<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue'
import type { Messages } from '../i18n'

defineProps<{ t: Messages }>()
const emit = defineEmits<{ submit: [] }>()

const kilograms = defineModel<string>('kilograms', { required: true })
const date = defineModel<string>('date', { required: true })
</script>

<template>
  <form class="weight-card border border-border-light rounded-[18px] bg-white shadow-[0_5px_22px_rgba(45,72,62,0.05)] p-5 border-t-3 border-t-mint" @submit.prevent="emit('submit')">
    <div class="flex items-center gap-2.5">
      <span class="grid place-items-center w-[30px] h-[30px] rounded-[10px] text-[#478e79] bg-[#e9f6f1] font-extrabold" aria-hidden="true">↗</span>
      <h2 class="m-0 text-[19px] font-extrabold">{{ t.addWeight }}</h2>
    </div>
    <label class="flex flex-col gap-1.5 mt-3.5 text-[#56635f] text-[13px] font-semibold">
      {{ t.weight }}
      <input v-model="kilograms" type="number" min="0.1" max="50" step="0.01" required inputmode="decimal" class="w-full border border-[#d9e1dd] rounded-[10px] px-3 py-2.5 text-text-primary bg-[#fbfcfb] outline-none transition-all focus:border-focus focus:ring-3 focus:ring-focus-ring focus:bg-white" />
    </label>
    <label class="flex flex-col gap-1.5 mt-3.5 text-[#56635f] text-[13px] font-semibold">
      {{ t.date }}
      <input v-model="date" type="date" required class="w-full border border-[#d9e1dd] rounded-[10px] px-3 py-2.5 text-text-primary bg-[#fbfcfb] outline-none transition-all focus:border-focus focus:ring-3 focus:ring-focus-ring focus:bg-white" />
    </label>
    <UButton class="w-full mt-4 justify-center rounded-[11px] font-bold shadow-[0_2px_6px_rgba(45,72,62,0.12)] hover:shadow-[0_5px_12px_rgba(72,138,117,0.24)] hover:-translate-y-px transition-all" type="submit" color="success">{{ t.saveWeight }}</UButton>
  </form>
</template>
