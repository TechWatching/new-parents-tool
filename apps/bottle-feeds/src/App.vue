<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { messages, type Language } from './i18n'
import { loadData, saveData } from './storage'
import type { Feed, Weight } from './types'

const nowForInput = () => {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

const timePattern = /(?:[01]\d|2[0-3]):[0-5]\d/
const validTime = new RegExp(`^${timePattern.source}$`)

const dateTimeForInput = () => {
  const value = nowForInput()
  return { date: value.slice(0, 10), time: value.slice(11) }
}

const data = reactive(loadData())
const language = ref<Language>(
  (localStorage.getItem('new-parents-tool:language') as Language) || 'en',
)
const range = ref<'24h' | '7d'>('7d')
const feedForm = reactive({ amount: '', ...dateTimeForInput(), comment: '' })
const weightForm = reactive({ kilograms: '', ...dateTimeForInput() })

const t = computed(() => messages[language.value])
const locale = computed(() => (language.value === 'fr' ? 'fr-FR' : 'en-GB'))

watch(data, (value) => saveData(value), { deep: true })
watch(
  language,
  (value) => {
    localStorage.setItem('new-parents-tool:language', value)
    document.documentElement.lang = value
  },
  { immediate: true },
)

function makeId() {
  return crypto.randomUUID()
}

function occurredAt(date: string, time: string) {
  if (!validTime.test(time)) return null

  const value = new Date(`${date}T${time}`)
  return Number.isNaN(value.getTime()) ? null : value.toISOString()
}

function addFeed() {
  const amount = Number(feedForm.amount)
  const recordedAt = occurredAt(feedForm.date, feedForm.time)
  if (!amount || amount <= 0 || !recordedAt) return
  data.feeds.unshift({
    id: makeId(),
    amount,
    occurredAt: recordedAt,
    comment: feedForm.comment.trim(),
  })
  feedForm.amount = ''
  feedForm.comment = ''
  Object.assign(feedForm, dateTimeForInput())
}

function addWeight() {
  const kilograms = Number(weightForm.kilograms)
  const recordedAt = occurredAt(weightForm.date, weightForm.time)
  if (!kilograms || kilograms <= 0 || !recordedAt) return
  data.weights.unshift({
    id: makeId(),
    kilograms,
    occurredAt: recordedAt,
  })
  weightForm.kilograms = ''
  Object.assign(weightForm, dateTimeForInput())
}

const sortedFeeds = computed(() =>
  [...data.feeds].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)),
)
const sortedWeights = computed(() =>
  [...data.weights].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)),
)
const cutoff24h = computed(() => Date.now() - 24 * 60 * 60 * 1000)
const feeds24h = computed(() =>
  data.feeds.filter((feed) => Date.parse(feed.occurredAt) >= cutoff24h.value),
)
const total24h = computed(() => feeds24h.value.reduce((total, feed) => total + feed.amount, 0))
const latestWeight = computed(() => sortedWeights.value[0])
const dailyGuide = computed(() =>
  latestWeight.value ? Math.round(latestWeight.value.kilograms * 150) : null,
)

function formatDate(value: string) {
  return new Intl.DateTimeFormat(locale.value, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function shortDay(date: Date) {
  return new Intl.DateTimeFormat(locale.value, { weekday: 'short' }).format(date)
}

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
        label: new Intl.DateTimeFormat(locale.value, { hour: '2-digit' }).format(new Date(end)),
        amount: data.feeds
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
      label: shortDay(date),
      amount: data.feeds
        .filter((feed) => {
          const time = Date.parse(feed.occurredAt)
          return time >= date.getTime() && time < next.getTime()
        })
        .reduce((total, feed) => total + feed.amount, 0),
    }
  })
})

const intakeMax = computed(() =>
  Math.max(...intakePoints.value.map((point) => point.amount), dailyGuide.value || 0, 1),
)

const visibleWeights = computed(() => {
  const cutoff = Date.now() - (range.value === '24h' ? 24 : 7 * 24) * 60 * 60 * 1000
  return [...data.weights]
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

function removeFeed(feed: Feed) {
  const index = data.feeds.findIndex((item) => item.id === feed.id)
  if (index !== -1) data.feeds.splice(index, 1)
}

function removeWeight(weight: Weight) {
  const index = data.weights.findIndex((item) => item.id === weight.id)
  if (index !== -1) data.weights.splice(index, 1)
}
</script>

<template>
  <header class="site-header">
    <div>
      <a class="brand" href="#">
        <span class="brand-mark" aria-hidden="true">◒</span>
        <span>{{ t.appName }}</span>
      </a>
      <p>{{ t.tagline }}</p>
    </div>
    <button
      class="language-button"
      type="button"
      @click="language = language === 'en' ? 'fr' : 'en'"
    >
      {{ t.language }}
    </button>
  </header>

  <main>
    <div class="privacy-note"><span aria-hidden="true">⌁</span> {{ t.privacy }}</div>

    <section class="entry-grid" aria-label="Data entry">
      <form class="card form-card feed-card" @submit.prevent="addFeed">
        <div class="section-heading">
          <span class="icon coral" aria-hidden="true">＋</span>
          <h2>{{ t.addFeed }}</h2>
        </div>
        <div class="form-grid">
          <label>
            {{ t.amount }}
            <input
              v-model="feedForm.amount"
              type="number"
              min="1"
              max="2000"
              step="1"
              required
              inputmode="decimal"
            />
          </label>
          <label>
            {{ t.date }}
            <input v-model="feedForm.date" type="date" required />
          </label>
          <label>
            {{ t.time }}
            <input
              v-model="feedForm.time"
              type="text"
              inputmode="numeric"
              :pattern="timePattern.source"
              placeholder="14:30"
              maxlength="5"
              required
            />
          </label>
          <label class="full-width">
            {{ t.comment }}
            <input
              v-model="feedForm.comment"
              type="text"
              maxlength="160"
              :placeholder="t.commentPlaceholder"
            />
          </label>
        </div>
        <button class="primary-button" type="submit">{{ t.saveFeed }}</button>
      </form>

      <form class="card form-card weight-card" @submit.prevent="addWeight">
        <div class="section-heading">
          <span class="icon mint" aria-hidden="true">↗</span>
          <h2>{{ t.addWeight }}</h2>
        </div>
        <label>
          {{ t.weight }}
          <input
            v-model="weightForm.kilograms"
            type="number"
            min="0.1"
            max="50"
            step="0.01"
            required
            inputmode="decimal"
          />
        </label>
        <label>
          {{ t.date }}
          <input v-model="weightForm.date" type="date" required />
        </label>
        <label>
          {{ t.time }}
          <input
            v-model="weightForm.time"
            type="text"
            inputmode="numeric"
            :pattern="timePattern.source"
            placeholder="14:30"
            maxlength="5"
            required
          />
        </label>
        <button class="secondary-button" type="submit">{{ t.saveWeight }}</button>
      </form>
    </section>

    <section class="summary-grid" :aria-label="t.today">
      <article class="metric-card">
        <span>{{ t.today }}</span>
        <strong>{{ feeds24h.length }}</strong>
        <small>{{ t.bottles }}</small>
      </article>
      <article class="metric-card">
        <span>{{ t.total }}</span>
        <strong
          >{{ total24h }} <small>{{ t.ml }}</small></strong
        >
        <div v-if="dailyGuide" class="progress">
          <i :style="{ width: `${Math.min((total24h / dailyGuide) * 100, 100)}%` }"></i>
        </div>
      </article>
      <article class="metric-card">
        <span>{{ t.latestWeight }}</span>
        <strong
          >{{ latestWeight ? latestWeight.kilograms.toLocaleString(locale) : '—' }}
          <small>{{ t.kg }}</small></strong
        >
        <small v-if="latestWeight">{{ formatDate(latestWeight.occurredAt) }}</small>
      </article>
      <article class="metric-card guide-card">
        <span>{{ t.dailyGuide }}</span>
        <strong
          >{{ dailyGuide ?? '—' }} <small v-if="dailyGuide">{{ t.ml }}</small></strong
        >
        <small>{{ dailyGuide ? t.guideDetail : t.noWeight }}</small>
      </article>
    </section>

    <p class="disclaimer">{{ t.disclaimer }}</p>

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
      </div>
    </section>

    <section class="history-grid">
      <article class="card history-card">
        <h2>{{ t.history }}</h2>
        <p v-if="!sortedFeeds.length" class="empty-state">{{ t.emptyHistory }}</p>
        <ul v-else>
          <li v-for="feed in sortedFeeds.slice(0, 8)" :key="feed.id">
            <div>
              <strong>{{ feed.amount }} {{ t.ml }}</strong
              ><span>{{ formatDate(feed.occurredAt) }}</span
              ><small v-if="feed.comment">{{ feed.comment }}</small>
            </div>
            <button
              type="button"
              :aria-label="`${t.delete} ${feed.amount} ${t.ml}`"
              @click="removeFeed(feed)"
            >
              ×
            </button>
          </li>
        </ul>
      </article>
      <article class="card history-card">
        <h2>{{ t.weightHistory }}</h2>
        <p v-if="!sortedWeights.length" class="empty-state">{{ t.emptyWeights }}</p>
        <ul v-else>
          <li v-for="weight in sortedWeights.slice(0, 8)" :key="weight.id">
            <div>
              <strong>{{ weight.kilograms.toLocaleString(locale) }} {{ t.kg }}</strong
              ><span>{{ formatDate(weight.occurredAt) }}</span>
            </div>
            <button
              type="button"
              :aria-label="`${t.delete} ${weight.kilograms} ${t.kg}`"
              @click="removeWeight(weight)"
            >
              ×
            </button>
          </li>
        </ul>
      </article>
    </section>
  </main>
</template>
