<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { usePreferredLanguages } from '@vueuse/core'
import UButton from '@nuxt/ui/components/Button.vue'
import UTabs from '@nuxt/ui/components/Tabs.vue'
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const nowForInput = () => {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/

function maskTimeValue(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 4)
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}:${digits.slice(2)}`
}

const dateTimeForInput = () => {
  const value = nowForInput()
  return { date: value.slice(0, 10), time: value.slice(11) }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const data = reactive<AppData>({ feeds: [], weights: [] })
const loading = ref(true)
const currentNamespace = ref<Namespace>(GUEST_NAMESPACE)
const preferredLanguages = usePreferredLanguages()

function resolveInitialLanguage(): Language {
  const stored = localStorage.getItem('new-parents-tool:language')
  if (stored === 'en' || stored === 'fr') return stored
  const browserLanguage = preferredLanguages.value[0] || 'en'
  return browserLanguage.toLowerCase().startsWith('fr') ? 'fr' : 'en'
}

const language = ref<Language>(resolveInitialLanguage())
const range = ref<'24h' | '7d'>('7d')
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
}

const feedTimeModel = timeModel(feedForm)
const weightTimeModel = timeModel(weightForm)
const editingFeedTimeModel = timeModel(editingFeed)
const editingWeightTimeModel = timeModel(editingWeight)

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

function occurredAt(date: string, time: string) {
  if (!timePattern.test(time)) return null
  const value = new Date(`${date}T${time}`)
  return Number.isNaN(value.getTime()) ? null : value.toISOString()
}

function dateTimeFromOccurredAt(value: string) {
  const date = new Date(value)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  const localValue = date.toISOString().slice(0, 16)
  return { date: localValue.slice(0, 10), time: localValue.slice(11) }
}

function addFeed() {
  const amount = Number(feedForm.amount)
  const recordedAt = occurredAt(feedForm.date, feedForm.time)
  if (!amount || amount <= 0 || !recordedAt) return
  const now = new Date().toISOString()
  data.feeds.unshift({ id: makeId(), amount, occurredAt: recordedAt, comment: feedForm.comment.trim(), updatedAt: now })
  feedForm.amount = ''
  feedForm.comment = ''
  Object.assign(feedForm, dateTimeForInput())
}

function addWeight() {
  const kilograms = Number(weightForm.kilograms)
  const recordedAt = occurredAt(weightForm.date, weightForm.time)
  if (!kilograms || kilograms <= 0 || !recordedAt) return
  const now = new Date().toISOString()
  data.weights.unshift({ id: makeId(), kilograms, occurredAt: recordedAt, updatedAt: now })
  weightForm.kilograms = ''
  Object.assign(weightForm, dateTimeForInput())
}

function editFeed(feed: Feed) {
  editingFeedId.value = feed.id
  Object.assign(editingFeed, {
    amount: String(feed.amount),
    ...dateTimeFromOccurredAt(feed.occurredAt),
    comment: feed.comment,
  })
}

function saveFeed(feed: Feed) {
  const amount = Number(editingFeed.amount)
  const recordedAt = occurredAt(editingFeed.date, editingFeed.time)
  if (!amount || amount <= 0 || !recordedAt) return
  Object.assign(feed, {
    amount,
    occurredAt: recordedAt,
    comment: editingFeed.comment.trim(),
    updatedAt: new Date().toISOString(),
  })
  editingFeedId.value = null
}

function editWeight(weight: Weight) {
  editingWeightId.value = weight.id
  Object.assign(editingWeight, {
    kilograms: String(weight.kilograms),
    ...dateTimeFromOccurredAt(weight.occurredAt),
  })
}

function saveWeight(weight: Weight) {
  const kilograms = Number(editingWeight.kilograms)
  const recordedAt = occurredAt(editingWeight.date, editingWeight.time)
  if (!kilograms || kilograms <= 0 || !recordedAt) return
  Object.assign(weight, {
    kilograms,
    occurredAt: recordedAt,
    updatedAt: new Date().toISOString(),
  })
  editingWeightId.value = null
}

function removeFeed(feed: Feed) {
  const target = data.feeds.find((f) => f.id === feed.id)
  if (target) {
    target.deletedAt = new Date().toISOString()
    target.updatedAt = new Date().toISOString()
  }
}

function removeWeight(weight: Weight) {
  const target = data.weights.find((w) => w.id === weight.id)
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
// Computed display data (unchanged logic, now uses active records)
// ---------------------------------------------------------------------------

const sortedFeeds = computed(() =>
  [...activeFeeds.value].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)),
)
const sortedWeights = computed(() =>
  [...activeWeights.value].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)),
)
const cutoff24h = computed(() => Date.now() - 24 * 60 * 60 * 1000)
const feeds24h = computed(() =>
  activeFeeds.value.filter((feed) => Date.parse(feed.occurredAt) >= cutoff24h.value),
)
const total24h = computed(() => feeds24h.value.reduce((total, feed) => total + feed.amount, 0))
const latestWeight = computed(() => sortedWeights.value[0])
const dailyGuide = computed(() =>
  latestWeight.value ? Math.round((latestWeight.value.kilograms * 1000) / 10 + 200) : null,
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
        amount: activeFeeds.value
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
      amount: activeFeeds.value
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
  return [...activeWeights.value]
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
      ? `${t.value.syncedAt} ${formatDate(lastSyncedAt.value.toISOString())}`
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
                v-model="feedTimeModel"
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
              v-model="weightTimeModel"
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
          <article v-if="range === '7d'" class="full-width">
            <h3>{{ t.rollingIntake }}</h3>
            <div v-if="rollingIntakePoints.some((p) => p.amount > 0)" class="line-chart rolling-intake-chart">
              <svg viewBox="0 0 300 100" preserveAspectRatio="none" role="img" :aria-label="t.rollingIntake">
                <polyline v-if="rollingIntakePolyline" :points="rollingIntakePolyline" />
                <template v-for="(point, i) in rollingIntakeCumulativePoints" :key="i">
                  <circle
                    v-if="point.amount > 0"
                    r="3"
                    :cx="15 + (i / 6) * 270"
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

      <section class="card measure-card" :aria-label="t.measures">
        <h2>{{ t.measures }}</h2>
        <UTabs
          v-model="measureTab"
          class="measure-tabs"
          :items="[
            { label: t.quantities, value: 'feeds' },
            { label: t.weights, value: 'weights' },
          ]"
          :content="false"
        />

        <p v-if="measureTab === 'feeds' && !sortedFeeds.length" class="empty-state">
          {{ t.emptyHistory }}
        </p>
        <ul v-else-if="measureTab === 'feeds'" class="measure-list">
          <li v-for="feed in sortedFeeds" :key="feed.id">
            <template v-if="editingFeedId === feed.id">
              <form @submit.prevent="saveFeed(feed)">
                <div class="measure-fields">
                  <label for="edit-feed-amount">
                    {{ t.amount }}
                    <input id="edit-feed-amount" v-model="editingFeed.amount" type="number" min="1" max="2000" required />
                  </label>
                  <label for="edit-feed-date">
                    {{ t.date }}
                    <input id="edit-feed-date" v-model="editingFeed.date" type="date" required />
                  </label>
                  <label for="edit-feed-time">
                    {{ t.time }}
                    <input
                      id="edit-feed-time"
                      v-model="editingFeedTimeModel"
                      type="text"
                      inputmode="numeric"
                      :pattern="timePattern.source"
                      placeholder="14:30"
                      maxlength="5"
                      required
                    />
                  </label>
                  <label for="edit-feed-comment">
                    {{ t.comment }}
                    <input id="edit-feed-comment" v-model="editingFeed.comment" type="text" maxlength="160" />
                  </label>
                </div>
                <div class="measure-actions">
                  <UButton type="submit" size="xs">{{ t.save }}</UButton>
                  <UButton type="button" color="neutral" variant="ghost" size="xs" @click="editingFeedId = null">
                    {{ t.cancel }}
                  </UButton>
                </div>
              </form>
            </template>
            <template v-else>
              <div>
                <strong>{{ feed.amount }} {{ t.ml }}</strong><span>{{ formatDate(feed.occurredAt) }}</span
                ><small v-if="feed.comment">{{ feed.comment }}</small>
              </div>
              <UButton type="button" color="neutral" variant="soft" size="xs" @click="editFeed(feed)">
                {{ t.edit }}
              </UButton>
              <button class="delete-button" type="button" :aria-label="`${t.delete} ${feed.amount} ${t.ml}`" @click="removeFeed(feed)">
                ×
              </button>
            </template>
          </li>
        </ul>

        <p v-else-if="!sortedWeights.length" class="empty-state">{{ t.emptyWeights }}</p>
        <ul v-else class="measure-list">
          <li v-for="weight in sortedWeights" :key="weight.id">
            <template v-if="editingWeightId === weight.id">
              <form @submit.prevent="saveWeight(weight)">
                <div class="measure-fields">
                  <label for="edit-weight-kilograms">
                    {{ t.weight }}
                    <input id="edit-weight-kilograms" v-model="editingWeight.kilograms" type="number" min="0.1" max="50" step="0.01" required />
                  </label>
                  <label for="edit-weight-date">
                    {{ t.date }}
                    <input id="edit-weight-date" v-model="editingWeight.date" type="date" required />
                  </label>
                  <label for="edit-weight-time">
                    {{ t.time }}
                    <input
                      id="edit-weight-time"
                      v-model="editingWeightTimeModel"
                      type="text"
                      inputmode="numeric"
                      :pattern="timePattern.source"
                      placeholder="14:30"
                      maxlength="5"
                      required
                    />
                  </label>
                </div>
                <div class="measure-actions">
                  <UButton type="submit" size="xs">{{ t.save }}</UButton>
                  <UButton type="button" color="neutral" variant="ghost" size="xs" @click="editingWeightId = null">
                    {{ t.cancel }}
                  </UButton>
                </div>
              </form>
            </template>
            <template v-else>
              <div>
                <strong>{{ weight.kilograms.toLocaleString(locale) }} {{ t.kg }}</strong
                ><span>{{ formatDate(weight.occurredAt) }}</span>
              </div>
              <UButton type="button" color="neutral" variant="soft" size="xs" @click="editWeight(weight)">
                {{ t.edit }}
              </UButton>
              <button class="delete-button" type="button" :aria-label="`${t.delete} ${weight.kilograms} ${t.kg}`" @click="removeWeight(weight)">
                ×
              </button>
            </template>
          </li>
        </ul>
      </section>
    </main>
  </template>
</template>
