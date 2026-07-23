<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useTimeoutFn } from '@vueuse/core'
import UButton from '@nuxt/ui/components/Button.vue'
import ULocaleSelect from '@nuxt/ui/components/locale/LocaleSelect.vue'
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
import {
  dateFromOccurredAt,
  dateOnlyOccurredAt,
  dateTimeForInput,
  dateTimeFromOccurredAt,
  LATEST_ENTRY_DATE_DURATION,
  occurredAt,
} from './utils/time'
import { formatDate, formatDateOnly, formatRelativeTime, isRelativeTimeNow } from './utils/format'
import FeedForm from './components/FeedForm.vue'
import WeightForm from './components/WeightForm.vue'
import SummaryMetrics from './components/SummaryMetrics.vue'
import TrendsCharts from './components/TrendsCharts.vue'
import MeasureHistory from './components/MeasureHistory.vue'
import ReportGenerator from './components/ReportGenerator.vue'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const data = reactive<AppData>({ feeds: [], weights: [] })
const loading = ref(true)
const currentNamespace = ref<Namespace>(GUEST_NAMESPACE)
const now = ref(Date.now())
let nowIntervalId: number | undefined

function resolveInitialLanguage(): Language {
  const stored = localStorage.getItem('new-parents-tool:language')
  if (stored === 'en' || stored === 'fr') return stored
  const browserLanguage =
    Array.isArray(navigator.languages) && navigator.languages.length > 0
      ? navigator.languages[0]
      : navigator.language ?? 'en'
  return browserLanguage.toLowerCase().startsWith('fr') ? 'fr' : 'en'
}

const language = ref<Language>(resolveInitialLanguage())
const languageSelection = computed({
  get: () => language.value,
  set: (value: string) => {
    if (value === 'en' || value === 'fr') language.value = value
  },
})
const availableLocales = [
  { name: 'English', code: 'en', dir: 'ltr' as const, messages: {} },
  { name: 'Français', code: 'fr', dir: 'ltr' as const, messages: {} },
]
const feedForm = reactive({ amount: '', ...dateTimeForInput(), comment: '' })
const weightForm = reactive({ kilograms: '', date: dateTimeForInput().date })
const entryDateTimeoutDuration = ref(LATEST_ENTRY_DATE_DURATION)

// Auth form
const emailInput = ref('')

// Guest merge prompt
const showMergePrompt = ref(false)
const guestDataForMerge = ref<AppData | null>(null)

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

const handleVisibilityChange = () => {
  if (document.visibilityState === 'visible') {
    now.value = Date.now()
  }
}

onMounted(async () => {
  nowIntervalId = window.setInterval(() => {
    now.value = Date.now()
  }, 60_000)
  document.addEventListener('visibilitychange', handleVisibilityChange)

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
onUnmounted(() => {
  if (nowIntervalId !== undefined) {
    window.clearInterval(nowIntervalId)
  }
  window.removeEventListener('online', handleOnline)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})

// ---------------------------------------------------------------------------
// CRUD helpers
// ---------------------------------------------------------------------------

function makeId() {
  return crypto.randomUUID()
}

function defaultToCurrentDateTime() {
  const currentDateTime = dateTimeForInput()
  Object.assign(feedForm, currentDateTime)
  weightForm.date = currentDateTime.date
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
  toast.add({
    title: t.value.feedAdded,
    description: `${amount.toLocaleString(locale.value)} ${t.value.ml} · ${formatDate(recordedAt, locale.value)}`,
    color: 'success',
  })
}

function addWeight() {
  const kilograms = Number(weightForm.kilograms)
  const recordedAt = dateOnlyOccurredAt(weightForm.date)
  if (!kilograms || kilograms <= 0 || !recordedAt) return
  const now = new Date().toISOString()
  data.weights.unshift({ id: makeId(), kilograms, occurredAt: recordedAt, updatedAt: now })
  weightForm.kilograms = ''
  applyEntryDateWithReset(recordedAt)
  toast.add({
    title: t.value.weightAdded,
    description: `${kilograms.toLocaleString(locale.value)} ${t.value.kg} · ${formatDateOnly(recordedAt, locale.value)}`,
    color: 'success',
  })
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
  [...activeWeights.value].sort((a, b) => dateFromOccurredAt(b.occurredAt).localeCompare(dateFromOccurredAt(a.occurredAt))),
)
const latestWeight = computed(() => sortedWeights.value[0])
const latestFeed = computed(() => sortedFeeds.value[0])
const lastBottleSummary = computed(() => {
  if (!latestFeed.value) return null

  const relativeTime = formatRelativeTime(latestFeed.value.occurredAt, locale.value, now.value)
  const exactTimestamp = formatDate(latestFeed.value.occurredAt, locale.value)
  const isNow = isRelativeTimeNow(latestFeed.value.occurredAt, now.value)

  return {
    relativeTime: isNow
      ? t.value.timeSinceLastBottleNow
      : t.value.timeSinceLastBottleFormat.replace('{relativeTime}', relativeTime),
    details: t.value.lastBottleDetailsFormat
      .replace('{timestamp}', exactTimestamp)
      .replace('{amount}', latestFeed.value.amount.toLocaleString(locale.value)),
  }
})
const dailyGuide = computed(() =>
  latestWeight.value ? Math.round((latestWeight.value.kilograms * 1000) / 10 + 200) : null,
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
  toast.add({
    title: t.value.exportData,
    description: t.value.exportSuccess,
    color: 'success',
  })
}

function triggerImport() {
  importFileRef.value?.click()
}

async function handleImportFile(event: Event) {
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
      toast.add({
        title: t.value.importData,
        description: t.value.importError,
        color: 'error',
      })
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
    toast.add({
      title: t.value.importData,
      description: t.value.importSuccess,
      color: 'success',
    })
  } catch {
    toast.add({
      title: t.value.importData,
      description: t.value.importError,
      color: 'error',
    })
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
      <ULocaleSelect
        v-model="languageSelection"
        class="language-select"
        :aria-label="t.languageSelector"
        :locales="availableLocales"
        :ui="{ content: 'z-20' }"
        variant="outline"
      />
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

      <p v-if="lastBottleSummary" class="last-bottle-banner" role="status" aria-live="polite">
        <span>{{ lastBottleSummary.relativeTime }}</span>
        <span>{{ lastBottleSummary.details }}</span>
      </p>

      <!-- Sync status bar -->
      <div
        v-if="isSupabaseConfigured && isAuthenticated && syncStatus !== 'idle'"
        class="sync-bar"
        :class="{ 'sync-bar--error': syncStatus === 'error', 'sync-bar--pending': syncStatus === 'pending' }"
      >
        <span>{{ syncLabel }}</span>
        <UButton
          v-if="syncStatus === 'error' || syncStatus === 'pending'"
          type="button"
          class="sync-retry"
          color="neutral"
          variant="outline"
          size="xs"
          @click="triggerSync"
        >
          {{ t.syncRetry }}
        </UButton>
        <span v-if="syncError && syncStatus === 'error'" class="sync-error-detail">{{ syncError }}</span>
      </div>

      <!-- Export / Import -->
      <div class="toolbar-actions">
        <div class="data-actions">
          <UButton type="button" class="action-button" color="neutral" variant="outline" @click="exportData">
            {{ t.exportData }}
          </UButton>
          <UButton type="button" class="action-button" color="neutral" variant="outline" @click="triggerImport">
            {{ t.importData }}
          </UButton>
          <input
            ref="importFileRef"
            type="file"
            accept="application/json,.json"
            class="sr-only"
            :aria-label="t.importData"
            @change="handleImportFile"
          />
        </div>

        <ReportGenerator
          :feeds="activeFeeds"
          :weights="activeWeights"
          :t="t"
          :locale="locale"
        />
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

      <TrendsCharts
        :feeds="activeFeeds"
        :weights="activeWeights"
        :daily-guide="dailyGuide"
        :t="t"
        :locale="locale"
      />

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
