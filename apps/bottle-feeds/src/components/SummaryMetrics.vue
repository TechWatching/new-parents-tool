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
  <section class="summary-grid" :aria-label="t.today">
    <article class="metric-card">
      <span>{{ t.today }}</span>
      <strong>{{ feeds24h.length }}</strong>
      <small>{{ t.bottles }}</small>
    </article>
    <article class="metric-card">
      <span>{{ t.total }}</span>
      <strong>{{ total24h }} <small>{{ t.ml }}</small></strong>
      <div v-if="dailyGuide" class="progress">
        <i :style="{ width: `${Math.min((total24h / dailyGuide) * 100, 100)}%` }"></i>
      </div>
    </article>
    <article class="metric-card">
      <span>{{ t.latestWeight }}</span>
      <strong>{{ latestWeight ? latestWeight.kilograms.toLocaleString(locale) : '—' }} <small>{{ t.kg }}</small></strong>
      <small v-if="latestWeight">{{ formatDateOnly(latestWeight.occurredAt, locale) }}</small>
    </article>
    <article class="metric-card guide-card">
      <span>{{ t.dailyGuide }}</span>
      <strong>{{ dailyGuide ?? '—' }} <small v-if="dailyGuide">{{ t.ml }}</small></strong>
      <small>{{ dailyGuide ? t.guideDetail : t.noWeight }}</small>
    </article>
  </section>
</template>
