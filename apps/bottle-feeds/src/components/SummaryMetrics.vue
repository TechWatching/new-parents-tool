<script setup lang="ts">
import { computed } from 'vue'
import type { Messages } from '../i18n'
import type { Feed, Weight } from '../types'
import { formatDateOnly } from '../utils/format'

const props = defineProps<{
  feeds: Feed[]
  latestWeight: Weight | undefined
  dailyGuide: number | null
  t: Messages
  locale: string
}>()

const cutoff24h = computed(() => Date.now() - 24 * 60 * 60 * 1000)
const feeds24h = computed(() => props.feeds.filter((feed) => Date.parse(feed.occurredAt) >= cutoff24h.value))
const total24h = computed(() => feeds24h.value.reduce((total, feed) => total + feed.amount, 0))
</script>

<template>
  <section
    class="summary-grid grid grid-cols-2 gap-3.5 max-[500px]:grid-cols-1 lg:grid-cols-4"
    :aria-label="t.today"
  >
    <article class="metric-card surface min-h-[134px] p-5">
      <span class="block text-sm font-semibold text-muted">{{ t.today }}</span>
      <strong class="mt-3 block text-[1.75rem] font-extrabold text-highlighted">{{ feeds24h.length }}</strong>
      <small class="text-xs text-dimmed">{{ t.bottles }}</small>
    </article>
    <article class="metric-card surface min-h-[134px] p-5">
      <span class="block text-sm font-semibold text-muted">{{ t.total }}</span>
      <strong class="mt-3 block text-[1.75rem] font-extrabold text-highlighted">
        {{ total24h }} <small class="text-sm font-normal text-muted">{{ t.ml }}</small>
      </strong>
      <div v-if="dailyGuide" class="mt-3.5 h-1.5 overflow-hidden rounded-full bg-sage-100">
        <i
          class="block h-full rounded-[inherit] bg-coral-500"
          :style="{ width: `${Math.min((total24h / dailyGuide) * 100, 100)}%` }"
        ></i>
      </div>
    </article>
    <article class="metric-card surface min-h-[134px] p-5">
      <span class="block text-sm font-semibold text-muted">{{ t.latestWeight }}</span>
      <strong class="mt-3 block text-[1.75rem] font-extrabold text-highlighted">
        {{ latestWeight ? latestWeight.kilograms.toLocaleString(locale) : '—' }}
        <small class="text-sm font-normal text-muted">{{ t.kg }}</small>
      </strong>
      <small v-if="latestWeight" class="text-xs text-dimmed">{{ formatDateOnly(latestWeight.occurredAt, locale) }}</small>
    </article>
    <article class="guide-card metric-card min-h-[134px] rounded-2xl border border-amber-200/70 bg-amber-50/60 p-5 shadow-sm shadow-amber-900/[0.04]">
      <span class="block text-sm font-semibold text-amber-800/80">{{ t.dailyGuide }}</span>
      <strong class="mt-3 block text-[1.75rem] font-extrabold text-highlighted">
        {{ dailyGuide ?? '—' }} <small v-if="dailyGuide" class="text-sm font-normal text-muted">{{ t.ml }}</small>
      </strong>
      <small class="text-xs text-amber-800/70">{{ dailyGuide ? t.guideDetail : t.noWeight }}</small>
    </article>
  </section>
</template>
