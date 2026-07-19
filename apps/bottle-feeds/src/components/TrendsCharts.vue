<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Messages } from '../i18n'
import type { Feed, Weight } from '../types'
import { shortDay } from '../utils/format'

const props = defineProps<{
  feeds: Feed[]
  weights: Weight[]
  dailyGuide: number | null
  t: Messages
  locale: string
}>()

const range = ref<'24h' | '7d'>('7d')

interface ChartPoint {
  label: string
  amount: number
}

const intakePoints = computed<ChartPoint[]>(() => {
  if (range.value === '24h') {
    return Array.from({ length: 6 }, (_, index) => {
      const end = Date.now() - (5 - index) * 4 * 60 * 60 * 1000
      const start = end - 4 * 60 * 60 * 1000
      return {
        label: new Intl.DateTimeFormat(props.locale, { hour: '2-digit' }).format(new Date(end)),
        amount: props.feeds
          .filter((feed) => {
            const time = Date.parse(feed.occurredAt)
            return time > start && time <= end
          })
          .reduce((total, feed) => total + feed.amount, 0),
      }
    })
  }

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - (6 - index))
    const next = new Date(date)
    next.setDate(next.getDate() + 1)
    return {
      label: shortDay(date, props.locale),
      amount: props.feeds
        .filter((feed) => {
          const time = Date.parse(feed.occurredAt)
          return time >= date.getTime() && time < next.getTime()
        })
        .reduce((total, feed) => total + feed.amount, 0),
    }
  })
})

const intakeMax = computed(() =>
  Math.max(...intakePoints.value.map((point) => point.amount), props.dailyGuide || 0, 1),
)

const visibleWeights = computed(() => {
  const cutoff = Date.now() - (range.value === '24h' ? 24 : 7 * 24) * 60 * 60 * 1000
  return [...props.weights]
    .filter((weight) => Date.parse(weight.occurredAt) >= cutoff)
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
})

function weightPosition(weight: Weight, axis: 'x' | 'y') {
  const points = visibleWeights.value
  if (axis === 'x') {
    if (points.length <= 1) return 50
    return 6 + (points.indexOf(weight) / (points.length - 1)) * 88
  }
  const values = points.map((point) => point.kilograms)
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (min === max) return 50
  return 88 - ((weight.kilograms - min) / (max - min)) * 76
}

const weightPolyline = computed(() =>
  visibleWeights.value
    .map((weight) => `${weightPosition(weight, 'x')},${weightPosition(weight, 'y')}`)
    .join(' '),
)

// ---------------------------------------------------------------------------
// Rolling intake chart (6 × 4-hour windows = last 24 hours)
// ---------------------------------------------------------------------------

const rollingIntakePoints = computed<ChartPoint[]>(() =>
  Array.from({ length: 6 }, (_, index) => {
    const end = Date.now() - (5 - index) * 4 * 60 * 60 * 1000
    const start = end - 4 * 60 * 60 * 1000
    return {
      label: new Intl.DateTimeFormat(props.locale, { hour: '2-digit' }).format(new Date(end)),
      amount: props.feeds
        .filter((feed) => {
          const time = Date.parse(feed.occurredAt)
          return time > start && time <= end
        })
        .reduce((total, feed) => total + feed.amount, 0),
    }
  }),
)

const rollingIntakeCumulativePoints = computed<ChartPoint[]>(() => {
  let running = 0
  return rollingIntakePoints.value.map((p) => {
    running += p.amount
    return { label: p.label, amount: running }
  })
})

const rollingIntakeMax = computed(() =>
  Math.max(...rollingIntakeCumulativePoints.value.map((p) => p.amount), 1),
)

const rollingIntakePolyline = computed(() =>
  rollingIntakeCumulativePoints.value
    .map((point, i) => ({ point, i }))
    .filter(({ point }) => point.amount > 0)
    .map(({ point, i }) => `${15 + (i / 5) * 270},${88 - (point.amount / rollingIntakeMax.value) * 76}`)
    .join(' '),
)
</script>

<template>
  <section class="card trends">
    <div class="trends-header">
      <div class="section-heading">
        <span class="icon blue" aria-hidden="true">⌁</span>
        <h2>{{ t.overview }}</h2>
      </div>
      <div class="range-toggle">
        <button type="button" :class="{ active: range === '24h' }" @click="range = '24h'">
          {{ t.twentyFourHours }}
        </button>
        <button type="button" :class="{ active: range === '7d' }" @click="range = '7d'">
          {{ t.sevenDays }}
        </button>
      </div>
    </div>

    <div class="charts-grid">
      <article>
        <h3>{{ t.intake }}</h3>
        <div class="bar-chart" role="img" :aria-label="t.intake">
          <div v-for="point in intakePoints" :key="point.label" class="bar-column">
            <span v-if="point.amount" class="bar-value">{{ point.amount }}</span>
            <i
              :style="{
                height: `${Math.max((point.amount / intakeMax) * 100, point.amount ? 4 : 0)}%`,
              }"
            ></i>
            <small>{{ point.label }}</small>
          </div>
          <div
            v-if="dailyGuide && range === '7d'"
            class="guide-line"
            :style="{ bottom: `${30 + (dailyGuide / intakeMax) * 150}px` }"
          >
            <span>{{ dailyGuide }} {{ t.ml }} {{ t.goal }}</span>
          </div>
        </div>
      </article>
      <article>
        <h3>{{ t.growth }}</h3>
        <div v-if="visibleWeights.length" class="line-chart">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" :aria-label="t.growth">
            <polyline v-if="visibleWeights.length > 1" :points="weightPolyline" />
            <circle
              v-for="weight in visibleWeights"
              :key="weight.id"
              :cx="weightPosition(weight, 'x')"
              :cy="weightPosition(weight, 'y')"
              r="2.4"
            />
          </svg>
          <div class="weight-range">
            <span>{{ visibleWeights[0]?.kilograms }} {{ t.kg }}</span>
            <span>{{ visibleWeights[visibleWeights.length - 1]?.kilograms }} {{ t.kg }}</span>
          </div>
        </div>
        <div v-else class="chart-empty">{{ t.noChartData }}</div>
      </article>
      <article v-if="range === '7d'" class="full-width">
        <h3>{{ t.rollingIntake }}</h3>
        <div v-if="rollingIntakePoints.some((p) => p.amount > 0)" class="line-chart rolling-intake-chart">
          <svg viewBox="0 0 300 100" preserveAspectRatio="none" role="img" :aria-label="t.rollingIntake">
            <polyline v-if="rollingIntakePolyline" :points="rollingIntakePolyline" />
            <template v-for="(point, i) in rollingIntakeCumulativePoints" :key="i">
              <circle
                v-if="point.amount > 0"
                r="3"
                :cx="15 + (i / 5) * 270"
                :cy="88 - (point.amount / rollingIntakeMax) * 76"
              />
            </template>
          </svg>
          <div class="rolling-intake-labels">
            <div v-for="(point, i) in rollingIntakeCumulativePoints" :key="i" class="rolling-intake-col">
              <span class="rolling-intake-amount">{{ point.amount ? `${point.amount} ${t.ml}` : '' }}</span>
              <span>{{ point.label }}</span>
            </div>
          </div>
        </div>
        <div v-else class="chart-empty">{{ t.noChartData }}</div>
      </article>
    </div>
  </section>
</template>
