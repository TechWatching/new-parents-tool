<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue'
import type { Messages } from '../i18n'

defineProps<{ t: Messages }>()
const emit = defineEmits<{ submit: [] }>()

const kilograms = defineModel<string>('kilograms', { required: true })
const date = defineModel<string>('date', { required: true })
</script>

<template>
  <form class="weight-card surface border-t-[3px] border-t-mint-500 p-5 sm:p-6" @submit.prevent="emit('submit')">
    <div class="flex items-center gap-2.5">
      <span
        class="grid size-8 place-items-center rounded-[10px] bg-mint-50 text-lg font-extrabold text-mint-700"
        aria-hidden="true"
      >↗</span>
      <h2 class="text-lg font-extrabold text-highlighted">{{ t.addWeight }}</h2>
    </div>
    <label class="mt-4 flex flex-col gap-2 text-sm font-semibold text-toned">
      {{ t.weight }}
      <input
        v-model="kilograms"
        class="field"
        type="number"
        min="0.1"
        max="50"
        step="0.01"
        required
        inputmode="decimal"
      />
    </label>
    <label class="mt-3.5 flex flex-col gap-2 text-sm font-semibold text-toned">
      {{ t.date }}
      <input v-model="date" class="field" type="date" required />
    </label>
    <UButton class="mt-5 font-semibold" type="submit" color="secondary" block size="lg">
      {{ t.saveWeight }}
    </UButton>
  </form>
</template>
