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
  <section class="border border-border-light rounded-[18px] bg-white shadow-[0_5px_22px_rgba(45,72,62,0.05)] p-5">
    <div class="flex justify-between items-center max-sm:flex-col max-sm:items-start max-sm:gap-3.5">
      <div class="flex items-center gap-2.5">
        <span class="grid place-items-center w-[30px] h-[30px] rounded-[10px] text-[#5c80a0] bg-[#edf4fa] font-extrabold" aria-hidden="true">⌁</span>
        <h2 class="m-0 text-[19px] font-extrabold">{{ t.overview }}</h2>
      </div>
      <div class="flex p-[3px] rounded-[9px] bg-[#f0f3f1] max-sm:self-stretch">
        <button
          v-for="r in (['24h', '7d', 'all', 'custom'] as const)"
          :key="r"
          type="button"
          class="border-0 rounded-[7px] px-3 py-1.5 text-[#6e7b77] bg-transparent text-xs font-bold cursor-pointer max-sm:flex-1"
          :class="range === r ? 'text-[#33423d] bg-white shadow-[0_1px_4px_#d5dcd8]' : ''"
          @click="range = r"
        >
          {{ r === '24h' ? t.twentyFourHours : r === '7d' ? t.sevenDays : r === 'all' ? t.allTime : t.customRange }}
        </button>
      </div>
    </div>
    <div v-if="range === 'custom'" class="flex gap-3 mt-3.5 max-sm:w-full">
      <label class="grid gap-1 text-[#6e7b77] text-xs font-bold max-sm:flex-1">
        {{ t.startDate }}
        <input v-model="customRange.start" type="date" :max="customRange.end || undefined" class="px-2 py-1.5 border border-[#dfe6e2] rounded-[7px] text-[#45534f] bg-white font-[inherit]" />
      </label>
      <label class="grid gap-1 text-[#6e7b77] text-xs font-bold max-sm:flex-1">
        {{ t.endDate }}
        <input v-model="customRange.end" type="date" :min="customRange.start || undefined" class="px-2 py-1.5 border border-[#dfe6e2] rounded-[7px] text-[#45534f] bg-white font-[inherit]" />
      </label>
    </div>

    <div class="grid grid-cols-[1.2fr_1fr] gap-x-10 gap-y-5 mt-5 max-md:grid-cols-1 max-md:gap-7">
      <article>
        <h3 class="m-0 mb-3.5 text-[#63706c] text-[13px]">{{ t.intake }}</h3>
        <div class="relative flex items-end gap-2 h-[200px] px-1 pt-3 pb-7 border-b border-[#dfe6e2] bg-[repeating-linear-gradient(to_bottom,#eef2ef_0,#eef2ef_1px,transparent_1px,transparent_50px)]" role="img" :aria-label="t.intake">
          <div v-for="point in intakePoints" :key="point.label" class="relative flex flex-1 flex-col justify-end items-center h-full">
            <span v-if="point.amount" class="shrink-0 mb-1 text-[#6d7874] text-[9px]">{{ point.amount }}</span>
            <i
              class="w-[min(36px,72%)] min-h-0 shrink-0 rounded-t-[7px] rounded-b-[2px] bg-[#ee897d]"
              :style="{
                height: `${Math.max((point.amount / intakeMax) * 100, point.amount ? 4 : 0)}%`,
              }"
            ></i>
            <small class="absolute top-[calc(100%+8px)] text-[#85908c] text-[10px]">{{ point.label }}</small>
          </div>
          <div
            v-if="dailyGuide && range === '7d'"
            class="absolute right-0 left-0 z-[2] border-t border-dashed border-[#d8a260]"
            :style="{ bottom: `${30 + (dailyGuide / intakeMax) * 150}px` }"
          >
            <span class="absolute right-0 bottom-0.5 text-[#ad7d43] text-[9px]">{{ dailyGuide }} {{ t.ml }} {{ t.goal }}</span>
          </div>
        </div>
      </article>
      <article>
        <h3 class="m-0 mb-3.5 text-[#63706c] text-[13px]">{{ t.growth }}</h3>
        <div v-if="visibleWeights.length" class="line-chart relative h-[200px] border-b border-[#dfe6e2] bg-[repeating-linear-gradient(to_bottom,#eef2ef_0,#eef2ef_1px,transparent_1px,transparent_50px)]">
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
          <div class="flex justify-between text-[#74817d] text-[10px]">
            <span>{{ visibleWeights[0]?.kilograms }} {{ t.kg }}</span>
            <span>{{ visibleWeights[visibleWeights.length - 1]?.kilograms }} {{ t.kg }}</span>
          </div>
        </div>
        <div v-else class="grid place-items-center h-[200px] text-[#9aa39f] text-xs text-center">{{ t.noChartData }}</div>
      </article>
      <article>
        <h3 class="m-0 mb-3.5 text-[#63706c] text-[13px]">{{ t.bottlesPerDay }}</h3>
        <div class="bottle-count-chart relative flex items-end gap-2 h-[200px] px-1 pt-3 pb-7 border-b border-[#dfe6e2] bg-[repeating-linear-gradient(to_bottom,#eef2ef_0,#eef2ef_1px,transparent_1px,transparent_50px)]" role="img" :aria-label="t.bottlesPerDay">
          <div v-for="point in bottleCountPoints" :key="point.label" class="relative flex flex-1 flex-col justify-end items-center h-full">
            <span v-if="point.amount" class="shrink-0 mb-1 text-[#6d7874] text-[9px]">{{ point.amount }}</span>
            <i
              class="w-[min(36px,72%)] min-h-0 shrink-0 rounded-t-[7px] rounded-b-[2px] bg-[#ee897d]"
              :style="{
                height: `${Math.max((point.amount / bottleCountMax) * 100, point.amount ? 4 : 0)}%`,
              }"
            ></i>
            <small class="absolute top-[calc(100%+8px)] text-[#85908c] text-[10px]">{{ point.label }}</small>
          </div>
        </div>
      </article>
      <article class="col-span-full max-md:col-auto">
        <h3 class="m-0 mb-3.5 text-[#63706c] text-[13px]">{{ t.rollingIntake }}</h3>
        <div v-if="rollingIntakePoints.some((p) => p.amount > 0)" class="line-chart rolling-intake-chart relative h-[200px] border-b border-[#dfe6e2] bg-[repeating-linear-gradient(to_bottom,#eef2ef_0,#eef2ef_1px,transparent_1px,transparent_50px)]">
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
          <div class="flex justify-between px-[5%] pt-1">
            <div v-for="(point, i) in rollingIntakePoints" :key="i" class="rolling-intake-col flex flex-col items-center gap-px min-w-0">
              <span class="text-[9px] text-[#6d7874]">{{ point.amount ? `${point.amount} ${t.ml}` : '' }}</span>
              <span class="text-[10px] text-[#85908c]">{{ point.label }}</span>
            </div>
          </div>
        </div>
        <div v-else class="grid place-items-center h-[200px] text-[#9aa39f] text-xs text-center">{{ t.noChartData }}</div>
      </article>
    </div>
  </section>
</template>
