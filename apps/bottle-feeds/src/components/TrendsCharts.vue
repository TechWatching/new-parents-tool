<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { chartDateLabel, useTrendSeries, type TrendRange } from '../composables/useTrendSeries'
import type { Messages } from '../i18n'
import type { Feed, Weight } from '../types'

const props = withDefaults(defineProps<{
  feeds: Feed[]
  weights: Weight[]
  dailyGuide: number | null
  t: Messages
  locale: string
  now?: number
}>(), { now: () => Date.now() })

const range = ref<TrendRange>('7d')
const customRange = reactive({ start: '', end: '' })
const selectedWeight = ref<Weight | null>(null)

const feeds = computed(() => props.feeds)
const weights = computed(() => props.weights)
const locale = computed(() => props.locale)
const now = computed(() => props.now)

const {
  intakePoints,
  intakeMax: seriesIntakeMax,
  bottleCountPoints,
  bottleCountMax,
  visibleWeights,
  rollingIntakePoints,
  rollingIntakeMax,
  rollingIntakeChartWidth,
} = useTrendSeries(feeds, weights, range, customRange, locale, now)

// dailyGuide is a display concern (the goal line), not part of the data
// series, so it's folded into the chart's max only here, at render time.
const intakeMax = computed(() => Math.max(seriesIntakeMax.value, props.dailyGuide || 0))

const BAR_VALUE_LABEL_HEIGHT = 20
const CHART_TOP_PADDING = 12
const CHART_BOTTOM_PADDING = 30
const CHART_VERTICAL_PADDING = CHART_TOP_PADDING + CHART_BOTTOM_PADDING

const intakeGuidePosition = computed(() => {
  const ratio = (props.dailyGuide ?? 0) / intakeMax.value
  const reservedChartHeight = CHART_VERTICAL_PADDING + BAR_VALUE_LABEL_HEIGHT
  return `calc(${ratio * 100}% + ${CHART_BOTTOM_PADDING - ratio * reservedChartHeight}px)`
})

function chartBarHeight(amount: number, maximum: number) {
  if (!amount) return '0'
  const ratio = amount / maximum
  return `max(calc((100% - ${BAR_VALUE_LABEL_HEIGHT}px) * ${ratio}), 4px)`
}

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

function selectWeight(weight: Weight) {
  selectedWeight.value = selectedWeight.value === weight ? null : weight
}

const weightPolyline = computed(() =>
  visibleWeights.value
    .map((weight) => `${weightPosition(weight, 'x')},${weightPosition(weight, 'y')}`)
    .join(' '),
)

const selectedVisibleWeight = computed(() =>
  selectedWeight.value && visibleWeights.value.includes(selectedWeight.value) ? selectedWeight.value : null,
)

// ---------------------------------------------------------------------------
// Rolling intake chart: each point is the total quantity fed over the trailing
// 24 hours ending at that point. Shown for every selected range.
// ---------------------------------------------------------------------------

function rollingIntakeX(index: number) {
  // Guard against division by zero when there are 0 or 1 points.
  const denominator = Math.max(rollingIntakePoints.value.length - 1, 1)
  return 15 + (index / denominator) * (rollingIntakeChartWidth.value - 30)
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
  <section class="surface mt-[18px] p-5 sm:p-6">
    <div class="flex items-center justify-between gap-3.5 max-[500px]:flex-col max-[500px]:items-start">
      <div class="flex items-center gap-2.5">
        <span class="grid size-8 place-items-center rounded-[10px] bg-sky-50 text-lg font-extrabold text-sky-700" aria-hidden="true">⌁</span>
        <h2 class="text-lg font-extrabold text-highlighted">{{ t.overview }}</h2>
      </div>
      <div class="range-toggle flex rounded-[9px] bg-sage-100 p-[3px] max-[500px]:w-full">
        <button
          type="button"
          class="rounded-[7px] px-3 py-[7px] text-xs font-bold transition-colors max-[500px]:flex-1"
          :class="range === '24h' ? 'bg-white text-highlighted shadow-sm' : 'text-muted'"
          @click="range = '24h'"
        >
          {{ t.twentyFourHours }}
        </button>
        <button
          type="button"
          class="rounded-[7px] px-3 py-[7px] text-xs font-bold transition-colors max-[500px]:flex-1"
          :class="range === '7d' ? 'bg-white text-highlighted shadow-sm' : 'text-muted'"
          @click="range = '7d'"
        >
          {{ t.sevenDays }}
        </button>
        <button
          type="button"
          class="rounded-[7px] px-3 py-[7px] text-xs font-bold transition-colors max-[500px]:flex-1"
          :class="range === 'all' ? 'bg-white text-highlighted shadow-sm' : 'text-muted'"
          @click="range = 'all'"
        >
          {{ t.allTime }}
        </button>
        <button
          type="button"
          class="rounded-[7px] px-3 py-[7px] text-xs font-bold transition-colors max-[500px]:flex-1"
          :class="range === 'custom' ? 'bg-white text-highlighted shadow-sm' : 'text-muted'"
          @click="range = 'custom'"
        >
          {{ t.customRange }}
        </button>
      </div>
    </div>
    <div v-if="range === 'custom'" class="mt-3.5 flex gap-3 max-[500px]:w-full">
      <label class="grid gap-1 text-xs font-bold text-muted max-[500px]:flex-1">
        {{ t.startDate }}
        <input v-model="customRange.start" class="field py-1.5" type="date" :max="customRange.end || undefined" />
      </label>
      <label class="grid gap-1 text-xs font-bold text-muted max-[500px]:flex-1">
        {{ t.endDate }}
        <input v-model="customRange.end" class="field py-1.5" type="date" :min="customRange.start || undefined" />
      </label>
    </div>

    <div class="mt-[22px] grid grid-cols-1 gap-7 md:grid-cols-[1.2fr_1fr] md:gap-[42px]">
      <article>
        <h3 class="mb-3.5 text-[13px] text-muted">{{ t.intake }}</h3>
        <div
          class="chart-plot flex h-[220px] items-end gap-[9px] overflow-x-auto pb-[30px] pl-[5px] pt-3"
          :class="dailyGuide && range === '7d' ? 'pr-16' : 'pr-[5px]'"
          role="img"
          :aria-label="t.intake"
        >
          <div
            v-for="point in intakePoints"
            :key="point.label"
            class="relative flex h-full flex-1 flex-col items-center justify-end"
            :class="{ 'min-w-16': range === 'all' }"
          >
            <span v-if="point.amount" class="bar-value mb-1 h-4 shrink-0 text-[9px] leading-4 text-muted">{{ point.amount }}</span>
            <i
              class="w-[min(36px,72%)] min-h-0 shrink-0 rounded-t-[7px] rounded-b-[2px] bg-coral-400"
              :style="{ height: chartBarHeight(point.amount, intakeMax) }"
            ></i>
            <small class="absolute top-[calc(100%+8px)] whitespace-nowrap text-[10px] text-dimmed">{{ point.label }}</small>
          </div>
          <div
            v-if="dailyGuide && range === '7d'"
            class="intake-guide-line absolute left-0 right-16 z-[2] border-t border-dashed border-amber-500/70"
            :style="{ bottom: intakeGuidePosition }"
          >
            <span class="absolute bottom-0.5 left-full ml-1 whitespace-nowrap text-[9px] text-amber-700">{{ dailyGuide }} {{ t.ml }} {{ t.goal }}</span>
          </div>
        </div>
      </article>
      <article>
        <h3 class="mb-3.5 text-[13px] text-muted">{{ t.growth }}</h3>
        <div v-if="visibleWeights.length" class="chart-plot chart-line h-[200px]">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" :aria-label="t.growth">
            <polyline v-if="visibleWeights.length > 1" :points="weightPolyline" />
            <g
              v-for="weight in visibleWeights"
              :key="weight.id"
              class="weight-chart-point"
              :class="{ selected: weight === selectedVisibleWeight }"
              role="button"
              tabindex="0"
              :aria-label="`${chartDateLabel(new Date(weight.occurredAt), locale)}: ${weight.kilograms.toLocaleString(locale)} ${t.kg}`"
              @click="selectWeight(weight)"
              @keydown.enter.prevent="selectWeight(weight)"
              @keydown.space.prevent="selectWeight(weight)"
            >
              <title>{{ weight.kilograms.toLocaleString(locale) }} {{ t.kg }}</title>
              <circle class="weight-chart-hit-area" :cx="weightPosition(weight, 'x')" :cy="weightPosition(weight, 'y')" r="7" />
              <circle :cx="weightPosition(weight, 'x')" :cy="weightPosition(weight, 'y')" r="2.5" />
            </g>
          </svg>
          <div class="flex justify-between text-[10px] text-muted" aria-live="polite">
            <span v-if="selectedVisibleWeight" class="weight-chart-detail">
              {{ chartDateLabel(new Date(selectedVisibleWeight.occurredAt), locale) }}: {{ selectedVisibleWeight.kilograms.toLocaleString(locale) }} {{ t.kg }}
            </span>
            <template v-else>
              <span>{{ visibleWeights[0]?.kilograms }} {{ t.kg }}</span>
              <span>{{ visibleWeights[visibleWeights.length - 1]?.kilograms }} {{ t.kg }}</span>
            </template>
          </div>
        </div>
        <div v-else class="grid h-[200px] place-items-center text-center text-xs text-dimmed">{{ t.noWeightChartData }}</div>
      </article>
      <article>
        <h3 class="mb-3.5 text-[13px] text-muted">{{ t.bottlesPerDay }}</h3>
        <div class="bottle-count-chart chart-plot flex h-[220px] items-end gap-[9px] overflow-x-auto px-[5px] pb-[30px] pt-3" role="img" :aria-label="t.bottlesPerDay">
          <div
            v-for="point in bottleCountPoints"
            :key="point.label"
            class="relative flex h-full flex-1 flex-col items-center justify-end"
            :class="{ 'min-w-16': range === 'all' }"
          >
            <span v-if="point.amount" class="bar-value mb-1 h-4 shrink-0 text-[9px] leading-4 text-muted">{{ point.amount }}</span>
            <i
              class="w-[min(36px,72%)] min-h-0 shrink-0 rounded-t-[7px] rounded-b-[2px] bg-coral-400"
              :style="{ height: chartBarHeight(point.amount, bottleCountMax) }"
            ></i>
            <small class="absolute top-[calc(100%+8px)] whitespace-nowrap text-[10px] text-dimmed">{{ point.label }}</small>
          </div>
        </div>
      </article>
      <article class="full-width md:col-span-2">
        <h3 class="mb-3.5 text-[13px] text-muted">{{ t.rollingIntake }}</h3>
        <div v-if="rollingIntakePoints.some((p) => p.amount > 0)" class="overflow-x-auto">
          <div
            class="rolling-intake-chart chart-plot chart-line h-[200px]"
            :style="{ minWidth: range === 'all' ? `${rollingIntakeChartWidth}px` : undefined }"
          >
            <svg :viewBox="`0 0 ${rollingIntakeChartWidth} 100`" preserveAspectRatio="none" role="img" :aria-label="t.rollingIntake">
              <polyline v-if="rollingIntakePolyline" :points="rollingIntakePolyline" />
              <template v-for="(point, i) in rollingIntakePoints" :key="i">
                <circle
                  v-if="point.amount > 0"
                  :cx="rollingIntakeX(i)"
                  :cy="rollingIntakeY(point.amount)"
                  r="1.5"
                />
              </template>
            </svg>
            <div class="rolling-intake-labels flex justify-between px-[5%] pt-1">
              <div v-for="(point, i) in rollingIntakePoints" :key="i" class="rolling-intake-col flex min-w-0 flex-col items-center gap-px">
                <span class="rolling-intake-amount text-[9px] text-muted">{{ point.amount ? `${point.amount} ${t.ml}` : '' }}</span>
                <span class="text-[10px] text-dimmed">{{ point.label }}</span>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="grid h-[200px] place-items-center text-center text-xs text-dimmed">{{ t.noChartData }}</div>
      </article>
    </div>
  </section>
</template>
