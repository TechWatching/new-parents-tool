<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { Messages } from '../i18n'
import type { Feed, Weight } from '../types'
import { shortDay } from '../utils/format'
import { dateFromOccurredAt } from '../utils/time'

const props = defineProps<{
  feeds: Feed[]
  weights: Weight[]
  dailyGuide: number | null
  t: Messages
  locale: string
}>()

type TrendRange = '24h' | '7d' | 'all' | 'custom'

const range = ref<TrendRange>('7d')
const customRange = reactive({ start: '', end: '' })

interface ChartPoint {
  label: string
  amount: number
}

function chartDateLabel(date: Date) {
  return new Intl.DateTimeFormat(props.locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

const chartPeriod = computed(() => {
  if (range.value === '24h' || range.value === '7d') {
    if (range.value === '24h') return null
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const start = new Date(today)
    start.setDate(start.getDate() - 6)
    const end = new Date(today)
    end.setDate(end.getDate() + 1)
    return { start, end }
  }

  if (range.value === 'custom') {
    let start = customRange.start ? new Date(`${customRange.start}T00:00`) : null
    let end = customRange.end ? new Date(`${customRange.end}T00:00`) : null
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
    if (start > end) [start, end] = [end, start]
    end.setDate(end.getDate() + 1)
    return { start, end }
  }

  // 'all' range
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const earliestRecord = [...props.feeds, ...props.weights]
    .map((record) => Date.parse(record.occurredAt))
    .filter(Number.isFinite)
    .reduce((earliest, time) => Math.min(earliest, time), Infinity)
  if (!Number.isFinite(earliestRecord)) return null
  const start = new Date(earliestRecord)
  start.setHours(0, 0, 0, 0)
  const end = new Date(today)
  end.setDate(end.getDate() + 1)
  return { start, end }
})

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

  const period = chartPeriod.value
  if (!period) return []
  const points: ChartPoint[] = []
  for (const date = new Date(period.start); date < period.end; date.setDate(date.getDate() + 1)) {
    const next = new Date(date)
    next.setDate(next.getDate() + 1)
    points.push({
      label: range.value === '7d' ? shortDay(date, props.locale) : chartDateLabel(date),
      amount: props.feeds
        .filter((feed) => {
          const time = Date.parse(feed.occurredAt)
          return time >= date.getTime() && time < next.getTime()
        })
        .reduce((total, feed) => total + feed.amount, 0),
    })
  }
  return points
})

const intakeMax = computed(() =>
  Math.max(...intakePoints.value.map((point) => point.amount), props.dailyGuide || 0, 1),
)

const bottleCountPoints = computed<ChartPoint[]>(() => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const period =
    range.value === '24h'
      ? { start: today, end: new Date(today.getTime() + 24 * 60 * 60 * 1000) }
      : chartPeriod.value
  if (!period) return []

  const points: ChartPoint[] = []
  let date = new Date(period.start)
  while (date < period.end) {
    const next = new Date(date)
    next.setDate(next.getDate() + 1)
    points.push({
      label: range.value === '7d' ? shortDay(date, props.locale) : chartDateLabel(date),
      amount: props.feeds.filter((feed) => {
        const time = Date.parse(feed.occurredAt)
        return time >= date.getTime() && time < next.getTime()
      }).length,
    })
    date = next
  }
  return points
})

const bottleCountMax = computed(() => Math.max(...bottleCountPoints.value.map((point) => point.amount), 1))

const visibleWeights = computed(() => {
  if (range.value === '24h') {
    const today = dateFromOccurredAt(new Date().toISOString())
    return [...props.weights]
      .filter((weight) => dateFromOccurredAt(weight.occurredAt) >= today)
      .sort((a, b) => dateFromOccurredAt(a.occurredAt).localeCompare(dateFromOccurredAt(b.occurredAt)))
  }
  const period = chartPeriod.value
  if (!period) return []
  const startDate = dateFromOccurredAt(period.start.toISOString())
  const endDate = dateFromOccurredAt(period.end.toISOString())
  return [...props.weights]
    .filter((weight) => {
      const date = dateFromOccurredAt(weight.occurredAt)
      return date >= startDate && date < endDate
    })
    .sort((a, b) => dateFromOccurredAt(a.occurredAt).localeCompare(dateFromOccurredAt(b.occurredAt)))
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
// Rolling intake chart: each point is the total quantity fed over the trailing
// 24 hours ending at that point. Shown for every selected range.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000

/** Sample points (an end time and its label) spanning the selected range. */
const rollingIntakeSamples = computed<{ label: string; end: number }[]>(() => {
  if (range.value === '24h') {
    return Array.from({ length: 6 }, (_, index) => {
      const end = Date.now() - (5 - index) * 4 * 60 * 60 * 1000
      return {
        label: new Intl.DateTimeFormat(props.locale, { hour: '2-digit' }).format(new Date(end)),
        end,
      }
    })
  }

  const period = chartPeriod.value
  if (!period) return []
  const now = Date.now()
  const samples: { label: string; end: number }[] = []
  for (const date = new Date(period.start); date < period.end; date.setDate(date.getDate() + 1)) {
    const next = new Date(date)
    next.setDate(next.getDate() + 1)
    // The trailing 24h window ends at the close of the day, capped at "now"
    // so we never sample into the future.
    const end = Math.min(next.getTime(), now)
    samples.push({
      label: range.value === '7d' ? shortDay(date, props.locale) : chartDateLabel(date),
      end,
    })
  }
  return samples
})

const rollingIntakePoints = computed<ChartPoint[]>(() =>
  rollingIntakeSamples.value.map((sample) => ({
    label: sample.label,
    amount: props.feeds
      .filter((feed) => {
        const time = Date.parse(feed.occurredAt)
        return time > sample.end - DAY_MS && time <= sample.end
      })
      .reduce((total, feed) => total + feed.amount, 0),
  })),
)

const rollingIntakeMax = computed(() =>
  Math.max(...rollingIntakePoints.value.map((p) => p.amount), 1),
)

function rollingIntakeX(index: number) {
  // Guard against division by zero when there are 0 or 1 points.
  const denominator = Math.max(rollingIntakePoints.value.length - 1, 1)
  return 15 + (index / denominator) * 270
}

function rollingIntakeY(amount: number) {
  return 88 - (amount / rollingIntakeMax.value) * 76
}

const rollingIntakePolyline = computed(() =>
  rollingIntakePoints.value
    .map((point, i) => ({ point, i }))
    .filter(({ point }) => point.amount > 0)
    .map(({ point, i }) => `${rollingIntakeX(i)},${rollingIntakeY(point.amount)}`)
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
        <button type="button" :class="{ active: range === 'all' }" @click="range = 'all'">
          {{ t.allTime }}
        </button>
        <button type="button" :class="{ active: range === 'custom' }" @click="range = 'custom'">
          {{ t.customRange }}
        </button>
      </div>
    </div>
    <div v-if="range === 'custom'" class="custom-range">
      <label>
        {{ t.startDate }}
        <input v-model="customRange.start" type="date" :max="customRange.end || undefined" />
      </label>
      <label>
        {{ t.endDate }}
        <input v-model="customRange.end" type="date" :min="customRange.start || undefined" />
      </label>
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
              r="1.2"
            />
          </svg>
          <div class="weight-range">
            <span>{{ visibleWeights[0]?.kilograms }} {{ t.kg }}</span>
            <span>{{ visibleWeights[visibleWeights.length - 1]?.kilograms }} {{ t.kg }}</span>
          </div>
        </div>
        <div v-else class="chart-empty">{{ t.noChartData }}</div>
      </article>
      <article>
        <h3>{{ t.bottlesPerDay }}</h3>
        <div class="bar-chart bottle-count-chart" role="img" :aria-label="t.bottlesPerDay">
          <div v-for="point in bottleCountPoints" :key="point.label" class="bar-column">
            <span v-if="point.amount" class="bar-value">{{ point.amount }}</span>
            <i
              :style="{
                height: `${Math.max((point.amount / bottleCountMax) * 100, point.amount ? 4 : 0)}%`,
              }"
            ></i>
            <small>{{ point.label }}</small>
          </div>
        </div>
      </article>
      <article class="full-width">
        <h3>{{ t.rollingIntake }}</h3>
        <div v-if="rollingIntakePoints.some((p) => p.amount > 0)" class="line-chart rolling-intake-chart">
          <svg viewBox="0 0 300 100" preserveAspectRatio="none" role="img" :aria-label="t.rollingIntake">
            <polyline v-if="rollingIntakePolyline" :points="rollingIntakePolyline" />
            <template v-for="(point, i) in rollingIntakePoints" :key="i">
              <circle
                v-if="point.amount > 0"
                :cx="rollingIntakeX(i)"
                :cy="rollingIntakeY(point.amount)"
              />
            </template>
          </svg>
          <div class="rolling-intake-labels">
            <div v-for="(point, i) in rollingIntakePoints" :key="i" class="rolling-intake-col">
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
