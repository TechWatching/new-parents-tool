<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useTimeoutFn } from '@vueuse/core'
import UButton from '@nuxt/ui/components/Button.vue'
import { useToast } from '@nuxt/ui/composables/useToast'
import { messages, type Language } from './i18n'
import { loadData, saveData, GUEST_NAMESPACE, type Namespace } from './storage'
import { isSupabaseConfigured } from './supabase'
import {
  initAuth,
  signInWithEmail,
  signOut,
  authUser,
  isAuthenticated,
  activeNamespace,
  authStep,
  authError,
} from './auth'
import { syncNow, onLocalMutation, syncStatus, syncError, lastSyncedAt } from './sync'
import { mergeAppData } from './merge'
import type { AppData, Feed, Weight } from './types'
import { dateTimeForInput, dateTimeFromOccurredAt, LATEST_ENTRY_DATE_DURATION, occurredAt } from './utils/time'
import { formatDate } from './utils/format'
import FeedForm from './components/FeedForm.vue'
import WeightForm from './components/WeightForm.vue'
import SummaryMetrics from './components/SummaryMetrics.vue'
import TrendsCharts from './components/TrendsCharts.vue'
import MeasureHistory from './components/MeasureHistory.vue'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const data = reactive<AppData>({ feeds: [], weights: [] })
const loading = ref(true)
const currentNamespace = ref<Namespace>(GUEST_NAMESPACE)

<<<<<<< HEAD
const language = ref<Language>(
  (localStorage.getItem('new-parents-tool:language') as Language) || 'en',
)
type TrendRange = '24h' | '7d' | 'all' | 'custom'

const range = ref<TrendRange>('7d')
const customRange = reactive({ start: '', end: '' })
const measureTab = ref<'feeds' | 'weights'>('feeds')
const feedForm = reactive({ amount: '', ...dateTimeForInput(), comment: '' })
const weightForm = reactive({ kilograms: '', ...dateTimeForInput() })
const editingFeedId = ref<string | null>(null)
const editingWeightId = ref<string | null>(null)
const editingFeed = reactive({ amount: '', date: '', time: '', comment: '' })
const editingWeight = reactive({ kilograms: '', date: '', time: '' })

function timeModel(form: { time: string }) {
  return computed({
    get: () => form.time,
    set: (value: string) => {
      form.time = maskTimeValue(value)
    },
  })
=======
function resolveInitialLanguage(): Language {
  const stored = localStorage.getItem('new-parents-tool:language')
  if (stored === 'en' || stored === 'fr') return stored
  const browserLanguage =
    Array.isArray(navigator.languages) && navigator.languages.length > 0
      ? navigator.languages[0]
      : navigator.language ?? 'en'
  return browserLanguage.toLowerCase().startsWith('fr') ? 'fr' : 'en'
>>>>>>> origin/main
}

const language = ref<Language>(resolveInitialLanguage())
const feedForm = reactive({ amount: '', ...dateTimeForInput(), comment: '' })
const weightForm = reactive({ kilograms: '', ...dateTimeForInput() })
const entryDateTimeoutDuration = ref(LATEST_ENTRY_DATE_DURATION)

// Auth form
const emailInput = ref('')

// Guest merge prompt
const showMergePrompt = ref(false)
const guestDataForMerge = ref<AppData | null>(null)

// Import feedback
const importFeedback = ref<'success' | 'error' | null>(null)
const importFileRef = ref<HTMLInputElement | null>(null)

// ---------------------------------------------------------------------------
// i18n & locale
// ---------------------------------------------------------------------------

const t = computed(() => messages[language.value])
const locale = computed(() => (language.value === 'fr' ? 'fr-FR' : 'en-GB'))

const toast = useToast()

watch(
  language,
  (value) => {
    localStorage.setItem('new-parents-tool:language', value)
    document.documentElement.lang = value
  },
  { immediate: true },
)

// ---------------------------------------------------------------------------
// Suppress-save flag (prevents watcher from writing during loading)
// ---------------------------------------------------------------------------

let _suppressSave = false

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

async function loadNamespace(ns: Namespace) {
  loading.value = true
  _suppressSave = true
  try {
    const loaded = await loadData(ns)
    data.feeds = loaded.feeds
    data.weights = loaded.weights
    currentNamespace.value = ns
    defaultToRecentEntryDate()
  } finally {
    _suppressSave = false
    loading.value = false
  }
}

onMounted(async () => {
  // 1. Restore Supabase session (no-op when not configured)
  await initAuth()

  // 2. Load data for the current namespace (guest or user)
  await loadNamespace(activeNamespace.value)

  // 3. If authenticated and online, trigger a background sync
  if (isAuthenticated.value && navigator.onLine) {
    triggerSync()
  }
})

// ---------------------------------------------------------------------------
// Auth state change handler
// ---------------------------------------------------------------------------

watch(activeNamespace, async (ns, prevNs) => {
  if (ns === prevNs) return

  if (ns !== GUEST_NAMESPACE) {
    // User just signed in – check whether there is guest data to offer merging
    const guest = await loadData(GUEST_NAMESPACE)
    const hasGuestData = guest.feeds.some((f) => !f.deletedAt) || guest.weights.some((w) => !w.deletedAt)
    if (hasGuestData) {
      guestDataForMerge.value = guest
      showMergePrompt.value = true
    }
  }

  // Load data for the new namespace
  await loadNamespace(ns)

  // Sync if authenticated
  if (isAuthenticated.value && navigator.onLine) {
    triggerSync()
  }
})

// ---------------------------------------------------------------------------
// Persist on data changes
// ---------------------------------------------------------------------------

watch(
  data,
  async (value) => {
    if (_suppressSave) return
    await saveData(JSON.parse(JSON.stringify(value)) as AppData, currentNamespace.value)
    if (isAuthenticated.value) {
      await onLocalMutation(currentNamespace.value)
    }
  },
  { deep: true },
)

// ---------------------------------------------------------------------------
// Online / sync
// ---------------------------------------------------------------------------

async function triggerSync() {
  const uid = authUser.value?.id
  if (!uid) return
  try {
    const ns = currentNamespace.value
    const merged = await syncNow(uid, ns, JSON.parse(JSON.stringify(data)) as AppData)
    _suppressSave = true
    data.feeds = merged.feeds
    data.weights = merged.weights
    _suppressSave = false
  } catch {
    // syncStatus is updated by sync.ts
  }
}

const handleOnline = () => {
  if (isAuthenticated.value) triggerSync()
}

onMounted(() => window.addEventListener('online', handleOnline))
onUnmounted(() => window.removeEventListener('online', handleOnline))

// ---------------------------------------------------------------------------
// CRUD helpers
// ---------------------------------------------------------------------------

function makeId() {
  return crypto.randomUUID()
}

function defaultToCurrentDateTime() {
  const currentDateTime = dateTimeForInput()
  Object.assign(feedForm, currentDateTime)
  Object.assign(weightForm, currentDateTime)
}

const { start: startEntryDateTimeout, stop: stopEntryDateTimeout } = useTimeoutFn(
  defaultToCurrentDateTime,
  entryDateTimeoutDuration,
  { immediate: false },
)

function applyEntryDateWithReset(recordedAt: string, duration = LATEST_ENTRY_DATE_DURATION) {
  const { date } = dateTimeFromOccurredAt(recordedAt)
  feedForm.date = date
  weightForm.date = date
  stopEntryDateTimeout()
  entryDateTimeoutDuration.value = duration
  startEntryDateTimeout()
}

function defaultToRecentEntryDate() {
  stopEntryDateTimeout()
  defaultToCurrentDateTime()
  const latestEntry = [...data.feeds, ...data.weights].reduce<{ entry: Feed | Weight; updatedAt: number } | undefined>(
    (latest, entry) => {
      const updatedAt = Date.parse(entry.updatedAt)
      if (entry.deletedAt || Number.isNaN(updatedAt) || (latest && latest.updatedAt >= updatedAt)) return latest
      return { entry, updatedAt }
    },
    undefined,
  )
  if (!latestEntry) return

  const expiresAt = latestEntry.updatedAt + LATEST_ENTRY_DATE_DURATION
  const now = Date.now()
  if (expiresAt <= now) return
  applyEntryDateWithReset(latestEntry.entry.occurredAt, expiresAt - now)
}

function addFeed() {
  const amount = Number(feedForm.amount)
  const recordedAt = occurredAt(feedForm.date, feedForm.time)
  if (!amount || amount <= 0 || !recordedAt) return
  const now = new Date().toISOString()
  data.feeds.unshift({ id: makeId(), amount, occurredAt: recordedAt, comment: feedForm.comment.trim(), updatedAt: now })
  feedForm.amount = ''
  feedForm.comment = ''
  applyEntryDateWithReset(recordedAt)
  toast.add({ title: t.value.feedAdded, color: 'success' })
}

function addWeight() {
  const kilograms = Number(weightForm.kilograms)
  const recordedAt = occurredAt(weightForm.date, weightForm.time)
  if (!kilograms || kilograms <= 0 || !recordedAt) return
  const now = new Date().toISOString()
  data.weights.unshift({ id: makeId(), kilograms, occurredAt: recordedAt, updatedAt: now })
  weightForm.kilograms = ''
  applyEntryDateWithReset(recordedAt)
  toast.add({ title: t.value.weightAdded, color: 'success' })
}

function saveFeed(payload: { id: string; amount: number; occurredAt: string; comment: string }) {
  const target = data.feeds.find((f) => f.id === payload.id)
  if (!target) return
  Object.assign(target, {
    amount: payload.amount,
    occurredAt: payload.occurredAt,
    comment: payload.comment,
    updatedAt: new Date().toISOString(),
  })
}

function saveWeight(payload: { id: string; kilograms: number; occurredAt: string }) {
  const target = data.weights.find((w) => w.id === payload.id)
  if (!target) return
  Object.assign(target, {
    kilograms: payload.kilograms,
    occurredAt: payload.occurredAt,
    updatedAt: new Date().toISOString(),
  })
}

function removeFeed(id: string) {
  const target = data.feeds.find((f) => f.id === id)
  if (target) {
    target.deletedAt = new Date().toISOString()
    target.updatedAt = new Date().toISOString()
  }
}

function removeWeight(id: string) {
  const target = data.weights.find((w) => w.id === id)
  if (target) {
    target.deletedAt = new Date().toISOString()
    target.updatedAt = new Date().toISOString()
  }
}

// ---------------------------------------------------------------------------
// Active (non-deleted) records
// ---------------------------------------------------------------------------

const activeFeeds = computed(() => data.feeds.filter((f) => !f.deletedAt))
const activeWeights = computed(() => data.weights.filter((w) => !w.deletedAt))

// ---------------------------------------------------------------------------
// Computed display data shared across the presentational components below
// ---------------------------------------------------------------------------

const sortedFeeds = computed(() =>
  [...activeFeeds.value].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)),
)
const sortedWeights = computed(() =>
  [...activeWeights.value].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)),
)
const latestWeight = computed(() => sortedWeights.value[0])
const dailyGuide = computed(() =>
  latestWeight.value ? Math.round((latestWeight.value.kilograms * 1000) / 10 + 200) : null,
)

<<<<<<< HEAD
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

function chartDayLabel(date: Date) {
  return new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short' }).format(date)
}

interface ChartPoint {
  label: string
  amount: number
}

const chartPeriod = computed(() => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (range.value === '7d') {
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

  const earliestRecord = [...activeFeeds.value, ...activeWeights.value]
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
        label: new Intl.DateTimeFormat(locale.value, { hour: '2-digit' }).format(new Date(end)),
        amount: activeFeeds.value
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
      label: range.value === '7d' ? shortDay(date) : chartDayLabel(date),
      amount: activeFeeds.value
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
  Math.max(...intakePoints.value.map((point) => point.amount), dailyGuide.value || 0, 1),
)

const visibleWeights = computed(() => {
  const period = chartPeriod.value
  const cutoff = range.value === '24h' ? Date.now() - 24 * 60 * 60 * 1000 : period?.start.getTime()
  const end = period?.end.getTime()
  return [...activeWeights.value]
    .filter((weight) => {
      const time = Date.parse(weight.occurredAt)
      return cutoff !== undefined && time >= cutoff && (end === undefined || time < end)
    })
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
// Rolling intake chart (7 × 4-hour windows = last 28 hours)
// ---------------------------------------------------------------------------

const rollingIntakePoints = computed<ChartPoint[]>(() =>
  Array.from({ length: 7 }, (_, index) => {
    const end = Date.now() - (6 - index) * 4 * 60 * 60 * 1000
    const start = end - 4 * 60 * 60 * 1000
    return {
      label: new Intl.DateTimeFormat(locale.value, { hour: '2-digit' }).format(new Date(end)),
      amount: activeFeeds.value
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
    .map(({ point, i }) => `${15 + (i / 6) * 270},${88 - (point.amount / rollingIntakeMax.value) * 76}`)
    .join(' '),
)

=======
>>>>>>> origin/main
// ---------------------------------------------------------------------------
// Export / Import
// ---------------------------------------------------------------------------

function exportData() {
  const snapshot: AppData = {
    feeds: activeFeeds.value,
    weights: activeWeights.value,
  }
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `little-sips-export-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function triggerImport() {
  importFileRef.value?.click()
}

async function handleImportFile(event: Event) {
  importFeedback.value = null
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const parsed: unknown = JSON.parse(text)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !Array.isArray((parsed as AppData).feeds) ||
      !Array.isArray((parsed as AppData).weights)
    ) {
      importFeedback.value = 'error'
      return
    }
    const now = new Date().toISOString()
    const imported = parsed as AppData
    const backfill = <T extends { updatedAt?: string; occurredAt: string }>(items: T[]): T[] =>
      items.map((item) => ({ ...item, updatedAt: item.updatedAt ?? item.occurredAt ?? now }))
    const toMerge: AppData = {
      feeds: backfill(imported.feeds) as Feed[],
      weights: backfill(imported.weights) as Weight[],
    }
    const current: AppData = JSON.parse(JSON.stringify(data)) as AppData
    const merged = mergeAppData(current, toMerge)
    data.feeds = merged.feeds
    data.weights = merged.weights
    importFeedback.value = 'success'
  } catch {
    importFeedback.value = 'error'
  } finally {
    input.value = ''
  }
}

// ---------------------------------------------------------------------------
// Guest merge
// ---------------------------------------------------------------------------

async function handleGuestMerge(action: 'merge' | 'keep') {
  showMergePrompt.value = false
  const guest = guestDataForMerge.value
  guestDataForMerge.value = null
  if (action === 'merge' && guest) {
    const current: AppData = JSON.parse(JSON.stringify(data)) as AppData
    const merged = mergeAppData(current, guest)
    data.feeds = merged.feeds
    data.weights = merged.weights
    // Persist merged data and trigger sync
    await saveData(JSON.parse(JSON.stringify(merged)) as AppData, currentNamespace.value)
    if (isAuthenticated.value && navigator.onLine) triggerSync()
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function handleSendMagicLink() {
  const email = emailInput.value.trim()
  if (!email) return
  try {
    await signInWithEmail(email)
  } catch {
    // authError ref is set by auth.ts
  }
}

async function handleSignOut() {
  await signOut()
  // Reload guest data
  await loadNamespace(GUEST_NAMESPACE)
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

const syncLabel = computed(() => {
  switch (syncStatus.value) {
    case 'syncing': return t.value.syncing
    case 'pending': return t.value.syncPending
    case 'error': return t.value.syncError
    case 'synced': return lastSyncedAt.value
      ? `${t.value.syncedAt} ${formatDate(lastSyncedAt.value.toISOString(), locale.value)}`
      : t.value.syncedAt
    default: return null
  }
})
</script>

<template>
  <!-- Loading overlay -->
  <div v-if="loading" class="loading-overlay" role="status" :aria-label="t.loading">
    <span class="loading-spinner" aria-hidden="true">◒</span>
    <span>{{ t.loading }}</span>
  </div>

  <template v-else>
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
      <!--
        When Supabase is configured we show the more detailed 'localOnly' message
        which explicitly mentions "Enable cloud sync to back them up."
        When Supabase is NOT configured we show the simpler 'privacy' note (no
        mention of cloud sync since there is no cloud option available).
      -->
      <div class="privacy-note local-only-note">
        <span aria-hidden="true">⌁</span>
        {{ isSupabaseConfigured ? t.localOnly : t.privacy }}
      </div>

      <!-- Sync status bar -->
      <div
        v-if="isSupabaseConfigured && isAuthenticated && syncStatus !== 'idle'"
        class="sync-bar"
        :class="{ 'sync-bar--error': syncStatus === 'error', 'sync-bar--pending': syncStatus === 'pending' }"
      >
        <span>{{ syncLabel }}</span>
        <button
          v-if="syncStatus === 'error' || syncStatus === 'pending'"
          type="button"
          class="sync-retry"
          @click="triggerSync"
        >
          {{ t.syncRetry }}
        </button>
        <span v-if="syncError && syncStatus === 'error'" class="sync-error-detail">{{ syncError }}</span>
      </div>

      <!-- Export / Import -->
      <div class="data-actions">
        <button type="button" class="action-button" @click="exportData">{{ t.exportData }}</button>
        <button type="button" class="action-button" @click="triggerImport">{{ t.importData }}</button>
        <input
          ref="importFileRef"
          type="file"
          accept="application/json,.json"
          class="sr-only"
          :aria-label="t.importData"
          @change="handleImportFile"
        />
        <span v-if="importFeedback === 'success'" class="import-feedback import-feedback--ok">
          {{ t.importSuccess }}
        </span>
        <span v-else-if="importFeedback === 'error'" class="import-feedback import-feedback--err">
          {{ t.importError }}
        </span>
      </div>

      <!-- Cloud sync / Auth section -->
      <section v-if="isSupabaseConfigured" class="card auth-card" :aria-label="t.cloudSync">
        <div class="section-heading">
          <span class="icon blue" aria-hidden="true">☁</span>
          <h2>{{ t.cloudSync }}</h2>
        </div>

        <template v-if="isAuthenticated">
          <p>{{ t.signedInAs }} <strong>{{ authUser?.email }}</strong></p>
          <UButton type="button" color="neutral" variant="ghost" size="sm" @click="handleSignOut">
            {{ t.signOut }}
          </UButton>
        </template>

        <template v-else-if="authStep === 'check-email'">
          <p>{{ t.checkEmail }}</p>
        </template>

        <template v-else>
          <form @submit.prevent="handleSendMagicLink">
            <label class="auth-email-label" for="auth-email">{{ t.emailLabel }}</label>
            <div class="auth-row">
              <input
                id="auth-email"
                v-model="emailInput"
                type="email"
                required
                autocomplete="email"
                class="auth-email-input"
              />
              <UButton type="submit" size="sm" :loading="authStep === 'sending'">
                {{ t.sendMagicLink }}
              </UButton>
            </div>
            <p v-if="authStep === 'error' && authError" class="auth-error">
              {{ t.authError }}: {{ authError }}
            </p>
          </form>
        </template>
      </section>

      <!-- Guest merge prompt modal -->
      <div v-if="showMergePrompt" class="modal-overlay" role="dialog" :aria-label="t.guestMergeTitle">
        <div class="modal-card card">
          <h2>{{ t.guestMergeTitle }}</h2>
          <p>{{ t.guestMergeBody }}</p>
          <div class="modal-actions">
            <UButton type="button" size="sm" @click="handleGuestMerge('merge')">
              {{ t.guestMergeYes }}
            </UButton>
            <UButton type="button" color="neutral" variant="ghost" size="sm" @click="handleGuestMerge('keep')">
              {{ t.guestMergeNo }}
            </UButton>
          </div>
        </div>
      </div>

      <section class="entry-grid" aria-label="Data entry">
        <FeedForm
          v-model:amount="feedForm.amount"
          v-model:date="feedForm.date"
          v-model:time="feedForm.time"
          v-model:comment="feedForm.comment"
          :t="t"
          @submit="addFeed"
        />
        <WeightForm
          v-model:kilograms="weightForm.kilograms"
          v-model:date="weightForm.date"
          v-model:time="weightForm.time"
          :t="t"
          @submit="addWeight"
        />
      </section>

      <SummaryMetrics
        :feeds="activeFeeds"
        :latest-weight="latestWeight"
        :daily-guide="dailyGuide"
        :t="t"
        :locale="locale"
      />

      <p class="disclaimer">{{ t.disclaimer }}</p>

<<<<<<< HEAD
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
=======
      <TrendsCharts
        :feeds="activeFeeds"
        :weights="activeWeights"
        :daily-guide="dailyGuide"
        :t="t"
        :locale="locale"
      />
>>>>>>> origin/main

      <MeasureHistory
        :feeds="sortedFeeds"
        :weights="sortedWeights"
        :t="t"
        :locale="locale"
        @save-feed="saveFeed"
        @remove-feed="removeFeed"
        @save-weight="saveWeight"
        @remove-weight="removeWeight"
      />
    </main>
  </template>
</template>
