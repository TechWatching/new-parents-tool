<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { messages, type Language } from './i18n'
import { extractTextFromImage, parseFeedEntries, parseFirstNumber } from './ocr'
import { loadData, saveData } from './storage'
import type { Feed, Weight } from './types'

const nowForInput = () => {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/

const dateTimeForInput = () => {
  const value = nowForInput()
  return { date: value.slice(0, 10), time: value.slice(11) }
}

const toLocalInputValue = (date: Date) => {
  const local = new Date(date)
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset())
  return local.toISOString().slice(0, 16)
}

const data = reactive(loadData())
const language = ref<Language>(
  (localStorage.getItem('new-parents-tool:language') as Language) || 'en',
)
const range = ref<'24h' | '7d'>('7d')
const feedForm = reactive({ amount: '', ...dateTimeForInput(), comment: '' })
const weightForm = reactive({ kilograms: '', ...dateTimeForInput() })
const editingFeedId = ref<string | null>(null)
const editingWeightId = ref<string | null>(null)
const feedScanning = ref(false)
const feedScanError = ref(false)
const feedScanAddedCount = ref<number | null>(null)
const weightScanning = ref(false)
const weightScanError = ref(false)

const t = computed(() => messages[language.value])
const locale = computed(() => (language.value === 'fr' ? 'fr-FR' : 'en-GB'))
const feedScanAddedMessage = computed(() =>
  t.value.scanAdded.replace('{count}', String(feedScanAddedCount.value ?? 0)),
)

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
  if (!timePattern.test(time)) return null

  const value = new Date(`${date}T${time}`)
  return Number.isNaN(value.getTime()) ? null : value.toISOString()
}

function resetFeedForm() {
  editingFeedId.value = null
  feedForm.amount = ''
  feedForm.comment = ''
  Object.assign(feedForm, dateTimeForInput())
  feedScanAddedCount.value = null
}

function resetWeightForm() {
  editingWeightId.value = null
  weightForm.kilograms = ''
  Object.assign(weightForm, dateTimeForInput())
}

function submitFeed() {
  const amount = Number(feedForm.amount)
  const recordedAt = occurredAt(feedForm.date, feedForm.time)
  if (!amount || amount <= 0 || !recordedAt) return
  const comment = feedForm.comment.trim()

  if (editingFeedId.value) {
    const feed = data.feeds.find((item) => item.id === editingFeedId.value)
    if (feed) {
      feed.amount = amount
      feed.occurredAt = recordedAt
      feed.comment = comment
    }
  } else {
    data.feeds.unshift({ id: makeId(), amount, occurredAt: recordedAt, comment })
  }
  resetFeedForm()
}

function submitWeight() {
  const kilograms = Number(weightForm.kilograms)
  const recordedAt = occurredAt(weightForm.date, weightForm.time)
  if (!kilograms || kilograms <= 0 || !recordedAt) return

  if (editingWeightId.value) {
    const weight = data.weights.find((item) => item.id === editingWeightId.value)
    if (weight) {
      weight.kilograms = kilograms
      weight.occurredAt = recordedAt
    }
  } else {
    data.weights.unshift({ id: makeId(), kilograms, occurredAt: recordedAt })
  }
  resetWeightForm()
}

function editFeed(feed: Feed) {
  editingFeedId.value = feed.id
  feedForm.amount = String(feed.amount)
  feedForm.comment = feed.comment
  const localValue = toLocalInputValue(new Date(feed.occurredAt))
  feedForm.date = localValue.slice(0, 10)
  feedForm.time = localValue.slice(11)
}

function editWeight(weight: Weight) {
  editingWeightId.value = weight.id
  weightForm.kilograms = String(weight.kilograms)
  const localValue = toLocalInputValue(new Date(weight.occurredAt))
  weightForm.date = localValue.slice(0, 10)
  weightForm.time = localValue.slice(11)
}

async function scanFeedPhoto(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  feedScanError.value = false
  feedScanAddedCount.value = null
  feedScanning.value = true
  try {
    const text = await extractTextFromImage(file)
    const entries = parseFeedEntries(text)
    const [firstEntry] = entries
    if (entries.length === 0 || !firstEntry) {
      feedScanError.value = true
    } else if (entries.length === 1) {
      feedForm.amount = String(firstEntry.amount)
      const localValue = toLocalInputValue(new Date(firstEntry.occurredAt))
      feedForm.date = localValue.slice(0, 10)
      feedForm.time = localValue.slice(11)
    } else {
      for (const entry of entries) {
        data.feeds.unshift({
          id: makeId(),
          amount: entry.amount,
          occurredAt: entry.occurredAt,
          comment: '',
        })
      }
      feedScanAddedCount.value = entries.length
    }
  } catch {
    feedScanError.value = true
  } finally {
    feedScanning.value = false
    input.value = ''
  }
}

async function scanWeightPhoto(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  weightScanError.value = false
  weightScanning.value = true
  try {
    const text = await extractTextFromImage(file)
    const kilograms = parseFirstNumber(text)
    if (kilograms === null) {
      weightScanError.value = true
    } else {
      weightForm.kilograms = String(kilograms)
    }
  } catch {
    weightScanError.value = true
  } finally {
    weightScanning.value = false
    input.value = ''
  }
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
  value: number
}

const cutoff7d = computed(() => Date.now() - 7 * 24 * 60 * 60 * 1000)
const feeds7d = computed(() =>
  data.feeds.filter((feed) => Date.parse(feed.occurredAt) >= cutoff7d.value),
)
const visibleFeeds = computed(() => (range.value === '24h' ? feeds24h.value : feeds7d.value))
const intakePoints = computed(() => {
  const now = Date.now()
  const step = range.value === '24h' ? 4 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000
  const length = range.value === '24h' ? 6 : 7
  const points: ChartPoint[] = []
  for (let i = length - 1; i >= 0; i--) {
    const start = now - (i + 1) * step
    const end = now - i * step
    const value = visibleFeeds.value
      .filter((feed) => {
        const time = Date.parse(feed.occurredAt)
        return time >= start && time < end
      })
      .reduce((total, feed) => total + feed.amount, 0)
    const label =
      range.value === '7d'
        ? shortDay(new Date(end - 1000))
        : new Intl.DateTimeFormat(locale.value, { hour: 'numeric' }).format(new Date(end))
    points.push({ label, value })
  }
  return points
})

const visibleWeights = computed(() =>
  sortedWeights.value.filter((weight) => Date.parse(weight.occurredAt) >= cutoff7d.value),
)

function barHeight(point: ChartPoint) {
  const max = Math.max(...intakePoints.value.map((point) => point.value))
  return max ? (point.value / max) * 100 : 0
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

const weightPolyline = computed(() =>
  visibleWeights.value
    .map((weight) => `${weightPosition(weight, 'x')},${weightPosition(weight, 'y')}`)
    .join(' '),
)

function removeFeed(feed: Feed) {
  const index = data.feeds.findIndex((item) => item.id === feed.id)
  if (index !== -1) data.feeds.splice(index, 1)
  if (editingFeedId.value === feed.id) resetFeedForm()
}

function removeWeight(weight: Weight) {
  const index = data.weights.findIndex((item) => item.id === weight.id)
  if (index !== -1) data.weights.splice(index, 1)
  if (editingWeightId.value === weight.id) resetWeightForm()
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
      <form class="card form-card feed-card" @submit.prevent="submitFeed">
        <div class="section-heading">
          <span class="icon coral" aria-hidden="true">＋</span>
          <h2>{{ editingFeedId ? t.editFeed : t.addFeed }}</h2>
        </div>
        <label class="scan-input">
          {{ t.scanPhoto }}
          <input type="file" accept="image/*" @change="scanFeedPhoto" />
        </label>
        <p v-if="feedScanning" class="scan-status">{{ t.scanning }}</p>
        <p v-else-if="feedScanError" class="scan-status scan-status-error">{{ t.scanError }}</p>
        <p v-else-if="feedScanAddedCount" class="scan-status">{{ feedScanAddedMessage }}</p>
        <p v-else-if="feedForm.amount" class="scan-status">{{ t.scanHint }}</p>
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
        <div class="form-actions">
          <button class="primary-button" type="submit">
            {{ editingFeedId ? t.saveChanges : t.saveFeed }}
          </button>
          <button
            v-if="editingFeedId"
            class="primary-button"
            type="button"
            @click="resetFeedForm"
          >
            {{ t.cancel }}
          </button>
        </div>
      </form>
      <form class="card form-card weight-card" @submit.prevent="submitWeight">
        <div class="section-heading">
          <span class="icon amber" aria-hidden="true">⚖</span>
          <h2>{{ editingWeightId ? t.editWeight : t.addWeight }}</h2>
        </div>
        <label class="scan-input">
          {{ t.scanPhoto }}
          <input type="file" accept="image/*" @change="scanWeightPhoto" />
        </label>
        <p v-if="weightScanning" class="scan-status">{{ t.scanning }}</p>
        <p v-else-if="weightScanError" class="scan-status scan-status-error">{{ t.scanError }}</p>
        <p v-else-if="weightForm.kilograms" class="scan-status">{{ t.scanHint }}</p>
        <div class="form-grid">
          <label>
            {{ t.weight }}
            <input
              v-model="weightForm.kilograms"
              type="number"
              min="0.1"
              max="25"
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
        </div>
        <div class="form-actions">
          <button class="secondary-button" type="submit">
            {{ editingWeightId ? t.saveChanges : t.saveWeight }}
          </button>
          <button
            v-if="editingWeightId"
            class="secondary-button"
            type="button"
            @click="resetWeightForm"
          >
            {{ t.cancel }}
          </button>
        </div>
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
              <span class="bar-fill" :style="{ height: `${barHeight(point)}%` }"></span>
              <span class="bar-label">{{ point.label }}</span>
            </div>
          </div>
        </article>
        <article>
          <h3>{{ t.weightTrend }}</h3>
          <div class="line-chart" role="img" :aria-label="t.weightTrend">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              <polyline
                v-if="visibleWeights.length > 1"
                :points="weightPolyline"
                fill="none"
                stroke="var(--brand-amber)"
                stroke-width="2"
                vector-effect="non-scaling-stroke"
              />
              <circle
                v-for="weight in visibleWeights"
                :key="weight.id"
                :cx="weightPosition(weight, 'x')"
                :cy="weightPosition(weight, 'y')"
                r="2"
                fill="var(--brand-amber)"
                vector-effect="non-scaling-stroke"
              />
            </svg>
          </div>
        </article>
      </div>
    </section>

    <section class="card history-card">
      <div class="section-heading">
        <span class="icon coral" aria-hidden="true">＋</span>
        <h2>{{ t.history }}</h2>
      </div>
      <div class="history-list">
        <div
          v-for="(feed, i) in sortedFeeds"
          :key="feed.id"
          class="history-row"
          :class="{ editing: editingFeedId === feed.id }"
        >
          <span class="history-item">{{ formatDate(feed.occurredAt) }}</span>
          <span class="history-value"
            >{{ feed.amount }} <small>{{ t.ml }}</small></span
          >
          <span v-if="feed.comment" class="history-comment">{{ feed.comment }}</span>
          <button
            v-if="i === 0 || !editingFeedId || editingFeedId === feed.id"
            class="edit-button"
            type="button"
            :aria-label="t.edit"
            @click="editFeed(feed)"
          >
            ✎
          </button>
          <button
            v-if="i === 0 || !editingFeedId || editingFeedId === feed.id"
            class="delete-button"
            type="button"
            :aria-label="t.delete"
            @click="removeFeed(feed)"
          >
            ✕
          </button>
        </div>
      </div>
    </section>

    <section class="card history-card">
      <div class="section-heading">
        <span class="icon amber" aria-hidden="true">⚖</span>
        <h2>{{ t.weightHistory }}</h2>
      </div>
      <div class="history-list">
        <div
          v-for="(weight, i) in sortedWeights"
          :key="weight.id"
          class="history-row"
          :class="{ editing: editingWeightId === weight.id }"
        >
          <span class="history-item">{{ formatDate(weight.occurredAt) }}</span>
          <span class="history-value"
            >{{ weight.kilograms.toLocaleString(locale) }} <small>{{ t.kg }}</small></span
          >
          <button
            v-if="i === 0 || !editingWeightId || editingWeightId === weight.id"
            class="edit-button"
            type="button"
            :aria-label="t.edit"
            @click="editWeight(weight)"
          >
            ✎
          </button>
          <button
            v-if="i === 0 || !editingWeightId || editingWeightId === weight.id"
            class="delete-button"
            type="button"
            :aria-label="t.delete"
            @click="removeWeight(weight)"
          >
            ✕
          </button>
        </div>
      </div>
    </section>
  </main>
</template>
