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
  <section class="summary-grid grid grid-cols-4 gap-3.5 mt-4 max-lg:grid-cols-2 max-sm:grid-cols-1" :aria-label="t.today">
    <article class="metric-card relative min-h-[134px] p-5 overflow-hidden border border-[#e4e9e6] rounded-2xl bg-white shadow-[0_2px_10px_rgba(45,72,62,0.025)]">
      <span class="block text-[#6a7773] text-[13px] font-semibold">{{ t.today }}</span>
      <strong class="block mt-3 text-[28px] font-extrabold">{{ feeds24h.length }}</strong>
      <small class="text-[#8a9491] text-[11px]">{{ t.bottles }}</small>
    </article>
    <article class="metric-card relative min-h-[134px] p-5 overflow-hidden border border-[#e4e9e6] rounded-2xl bg-white shadow-[0_2px_10px_rgba(45,72,62,0.025)]">
      <span class="block text-[#6a7773] text-[13px] font-semibold">{{ t.total }}</span>
      <strong class="block mt-3 text-[28px] font-extrabold">{{ total24h }} <small class="text-[#64716d] text-sm">{{ t.ml }}</small></strong>
      <div v-if="dailyGuide" class="h-[5px] mt-3.5 overflow-hidden rounded-[5px] bg-[#e9eeeb]">
        <i class="block h-full rounded-[inherit] bg-coral" :style="{ width: `${Math.min((total24h / dailyGuide) * 100, 100)}%` }"></i>
      </div>
    </article>
    <article class="metric-card relative min-h-[134px] p-5 overflow-hidden border border-[#e4e9e6] rounded-2xl bg-white shadow-[0_2px_10px_rgba(45,72,62,0.025)]">
      <span class="block text-[#6a7773] text-[13px] font-semibold">{{ t.latestWeight }}</span>
      <strong class="block mt-3 text-[28px] font-extrabold">{{ latestWeight ? latestWeight.kilograms.toLocaleString(locale) : '—' }} <small class="text-[#64716d] text-sm">{{ t.kg }}</small></strong>
      <small v-if="latestWeight" class="text-[#8a9491] text-[11px]">{{ formatDateOnly(latestWeight.occurredAt, locale) }}</small>
    </article>
    <article class="metric-card guide-card relative min-h-[134px] p-5 overflow-hidden border border-[#f1dec6] rounded-2xl bg-[#fff8f0] shadow-[0_2px_10px_rgba(45,72,62,0.025)]">
      <span class="block text-[#6a7773] text-[13px] font-semibold">{{ t.dailyGuide }}</span>
      <strong class="block mt-3 text-[28px] font-extrabold">{{ dailyGuide ?? '—' }} <small v-if="dailyGuide" class="text-[#64716d] text-sm">{{ t.ml }}</small></strong>
      <small class="text-[#8a9491] text-[11px]">{{ dailyGuide ? t.guideDetail : t.noWeight }}</small>
    </article>
  </section>
</template>
