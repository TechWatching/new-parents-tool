<script setup lang="ts">
import type { Messages } from '../i18n'

defineProps<{ t: Messages }>()
const emit = defineEmits<{ submit: [] }>()

const kilograms = defineModel<string>('kilograms', { required: true })
const date = defineModel<string>('date', { required: true })
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
      <input v-model="date" type="date" required />
    </label>
    <button class="secondary-button" type="submit">{{ t.saveWeight }}</button>
  </form>
</template>
