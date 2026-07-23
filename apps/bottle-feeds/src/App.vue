<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useTimeoutFn } from '@vueuse/core'
import UButton from '@nuxt/ui/components/Button.vue'
import ULocaleSelect from '@nuxt/ui/components/locale/LocaleSelect.vue'
import { useToast } from '@nuxt/ui/composables/useToast'
import { messages, type Language } from './i18n'
import {
  clearData,
  loadData,
  saveData,
  saveDataStrict,
  GUEST_NAMESPACE,
  type Namespace,
} from './storage'
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
import { deleteAllCloudData } from './remote'
import type { AppData, Feed, Weight } from './types'
import {
  dateFromOccurredAt,
  dateOnlyOccurredAt,
  dateTimeForInput,
  dateTimeFromOccurredAt,
  LATEST_ENTRY_DATE_DURATION,
  occurredAt,
} from './utils/time'
import { formatDate, formatDateOnly, formatRelativeTime } from './utils/format'
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
  if (stored === 'en' || stored === 'fr' || stored === 'es' || stored === 'de') return stored
  const browserLanguage =
    Array.isArray(navigator.languages) && navigator.languages.length > 0
      ? navigator.languages[0]
      : (navigator.language ?? 'en')
  const browserLocale = browserLanguage.toLowerCase()
  if (browserLocale.startsWith('fr')) return 'fr'
  if (browserLocale.startsWith('es')) return 'es'
  if (browserLocale.startsWith('de')) return 'de'
  return 'en'
}

const language = ref<Language>(resolveInitialLanguage())
const languageSelection = computed({
  get: () => language.value,
  set: (value: string) => {
    if (value === 'en' || value === 'fr' || value === 'es' || value === 'de') language.value = value
  },
})
const availableLocales = [
  { name: 'English', code: 'en', dir: 'ltr' as const, messages: {} },
  { name: 'Français', code: 'fr', dir: 'ltr' as const, messages: {} },
  { name: 'Español', code: 'es', dir: 'ltr' as const, messages: {} },
  { name: 'Deutsch', code: 'de', dir: 'ltr' as const, messages: {} },
]
const feedForm = reactive({ amount: '', ...dateTimeForInput(), comment: '' })
const weightForm = reactive({ kilograms: '', date: dateTimeForInput().date })
const entryDateTimeoutDuration = ref(LATEST_ENTRY_DATE_DURATION)

// Auth form
const emailInput = ref('')
const showDeleteCloudConfirm = ref(false)
const deletingCloudData = ref(false)

// Guest merge prompt
const showMergePrompt = ref(false)
const guestDataForMerge = ref<AppData | null>(null)

const importFileRef = ref<HTMLInputElement | null>(null)

// ---------------------------------------------------------------------------
// i18n & locale
// ---------------------------------------------------------------------------

const t = computed(() => messages[language.value])
const locale = computed(() => {
  const locales: Record<Language, string> = {
    en: 'en-GB',
    fr: 'fr-FR',
    es: 'es-ES',
    de: 'de-DE',
  }
  return locales[language.value]
})

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
  nowIntervalId = window.setInterval(() => {
    now.value = Date.now()
  }, 60_000)

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
    const hasGuestData =
      guest.feeds.some((f) => !f.deletedAt) || guest.weights.some((w) => !w.deletedAt)
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
  const latestEntry = [...data.feeds, ...data.weights].reduce<
    { entry: Feed | Weight; updatedAt: number } | undefined
  >((latest, entry) => {
    const updatedAt = Date.parse(entry.updatedAt)
    if (entry.deletedAt || Number.isNaN(updatedAt) || (latest && latest.updatedAt >= updatedAt))
      return latest
    return { entry, updatedAt }
  }, undefined)
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
  data.feeds.unshift({
    id: makeId(),
    amount,
    occurredAt: recordedAt,
    comment: feedForm.comment.trim(),
    updatedAt: now,
  })
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
  [...activeWeights.value].sort((a, b) =>
    dateFromOccurredAt(b.occurredAt).localeCompare(dateFromOccurredAt(a.occurredAt)),
  ),
)
const latestWeight = computed(() => sortedWeights.value[0])
const latestFeed = computed(() => sortedFeeds.value[0])
const lastBottleSummary = computed(() => {
  if (!latestFeed.value) return null

  const relativeTime = formatRelativeTime(latestFeed.value.occurredAt, locale.value, now.value)
  const exactTimestamp = formatDate(latestFeed.value.occurredAt, locale.value)

  return {
    relativeTime: t.value.timeSinceLastBottleFormat.replace('{relativeTime}', relativeTime),
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

async function handleDeleteCloudData() {
  const uid = authUser.value?.id
  if (!uid || deletingCloudData.value || syncStatus.value === 'syncing') return

  deletingCloudData.value = true
  const localSnapshot: AppData = {
    feeds: activeFeeds.value.map((feed) => ({ ...feed })),
    weights: activeWeights.value.map((weight) => ({ ...weight })),
  }

  try {
    const guestData = await loadData(GUEST_NAMESPACE)
    const localCopy = mergeAppData(guestData, localSnapshot)
    await saveDataStrict(localCopy, GUEST_NAMESPACE)
    await clearData(currentNamespace.value)
    await deleteAllCloudData(uid)
    await signOut()
    await loadNamespace(GUEST_NAMESPACE)
    showDeleteCloudConfirm.value = false
    toast.add({
      title: t.value.deleteCloudData,
      description: t.value.deleteCloudSuccess,
      color: 'success',
    })
  } catch {
    toast.add({
      title: t.value.deleteCloudData,
      description: t.value.deleteCloudError,
      color: 'error',
    })
  } finally {
    deletingCloudData.value = false
  }
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

const syncLabel = computed(() => {
  switch (syncStatus.value) {
    case 'syncing':
      return t.value.syncing
    case 'pending':
      return t.value.syncPending
    case 'error':
      return t.value.syncError
    case 'synced':
      return lastSyncedAt.value
        ? `${t.value.syncedAt} ${formatDate(lastSyncedAt.value.toISOString(), locale.value)}`
        : t.value.syncedAt
    default:
      return null
  }
})
</script>

<template>
  <!-- Loading overlay -->
  <div
    v-if="loading"
    class="flex min-h-dvh items-center justify-center gap-3 text-lg text-muted"
    role="status"
    :aria-label="t.loading"
  >
    <span class="inline-block text-2xl text-coral-500 motion-safe:animate-spin" aria-hidden="true">◒</span>
    <span>{{ t.loading }}</span>
  </div>

  <template v-else>
    <header
      class="sticky top-0 z-20 flex items-center justify-between border-b border-sage-200/70 bg-white/90 px-[max(1.5rem,calc((100vw-1180px)/2))] py-5 backdrop-blur-md max-[500px]:px-4 max-[500px]:py-4"
    >
      <div>
        <a
          class="flex items-center gap-2.5 text-2xl font-extrabold text-highlighted no-underline outline-none focus-visible:ring-3 focus-visible:ring-coral-500/30 focus-visible:rounded-lg max-[500px]:text-xl"
          href="#"
        >
          <span
            class="grid size-[34px] -rotate-[25deg] place-items-center rounded-full bg-coral-500 text-white"
            aria-hidden="true"
            >◒</span
          >
          <span>{{ t.appName }}</span>
        </a>
        <p class="ml-[43px] mt-0.5 text-[13px] text-muted max-[500px]:hidden">{{ t.tagline }}</p>
      </div>
      <ULocaleSelect
        v-model="languageSelection"
        class="min-w-[8.5rem]"
        :aria-label="t.languageSelector"
        :locales="availableLocales"
        :ui="{ content: 'z-30' }"
        variant="outline"
      />
    </header>

    <main class="mx-auto w-[min(1180px,calc(100%-2rem))] pb-[60px] pt-5 max-[500px]:pt-3.5">
      <!--
        When Supabase is configured we show the more detailed 'localOnly' message
        which explains that clearing site data erases local records and signing in enables sync.
        When Supabase is NOT configured we show the simpler 'privacy' note (no
        mention of cloud sync since there is no cloud option available).
      -->
      <div class="mb-[18px] text-center text-[13px] text-muted">
        <span class="font-bold text-mint-600" aria-hidden="true">⌁</span>
        {{ !isSupabaseConfigured ? t.privacy : isAuthenticated ? t.cloudEnabled : t.localOnly }}
      </div>

      <p
        v-if="lastBottleSummary"
        class="last-bottle-banner mb-[18px] grid justify-items-center gap-0.5 rounded-full border border-mint-100 bg-mint-50/40 px-4 py-2.5 text-center text-[13px] font-semibold text-mint-800"
        role="status"
        aria-live="polite"
      >
        <span>{{ lastBottleSummary.relativeTime }}</span>
        <span class="font-medium text-muted">{{ lastBottleSummary.details }}</span>
      </p>

      <!-- Sync status bar -->
      <div
        v-if="isSupabaseConfigured && isAuthenticated && syncStatus !== 'idle'"
        class="mb-3 flex items-center gap-2.5 rounded-lg px-4 py-2 text-sm"
        :class="
          syncStatus === 'error'
            ? 'bg-red-50 text-red-800'
            : syncStatus === 'pending'
              ? 'bg-amber-50 text-amber-800'
              : 'bg-sky-50 text-sky-800'
        "
      >
        <span>{{ syncLabel }}</span>
        <UButton
          v-if="syncStatus === 'error' || syncStatus === 'pending'"
          type="button"
          class="ml-auto"
          color="neutral"
          variant="outline"
          size="xs"
          @click="triggerSync"
        >
          {{ t.syncRetry }}
        </UButton>
        <span v-if="syncError && syncStatus === 'error'" class="ml-2 text-xs opacity-80">{{
          syncError
        }}</span>
      </div>

      <!-- Export / Import -->
      <div class="mb-[18px] flex flex-wrap items-center gap-2">
        <UButton type="button" color="neutral" variant="outline" @click="exportData">
          {{ t.exportData }}
        </UButton>
        <UButton type="button" color="neutral" variant="outline" @click="triggerImport">
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

        <ReportGenerator :feeds="activeFeeds" :weights="activeWeights" :t="t" :locale="locale" />
      </div>

      <!-- Cloud sync / Auth section -->
      <section v-if="isSupabaseConfigured" class="surface mb-6 p-5 sm:p-6" :aria-label="t.cloudSync">
        <div class="flex items-center gap-2.5">
          <span class="grid size-8 place-items-center rounded-[10px] bg-sky-50 text-lg font-extrabold text-sky-700" aria-hidden="true">☁</span>
          <h2 class="text-lg font-extrabold text-highlighted">{{ t.cloudSync }}</h2>
        </div>

        <template v-if="isAuthenticated">
          <p class="mt-3 text-sm text-toned">{{ t.signedInAs }} <strong class="text-highlighted">{{ authUser?.email }}</strong></p>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <UButton type="button" color="neutral" variant="ghost" size="sm" @click="handleSignOut">
              {{ t.signOut }}
            </UButton>
            <UButton
              type="button"
              color="error"
              variant="ghost"
              size="sm"
              :disabled="syncStatus === 'syncing'"
              :aria-expanded="showDeleteCloudConfirm"
              aria-controls="cloud-delete-confirm"
              @click="showDeleteCloudConfirm = true"
            >
              {{ t.deleteCloudData }}
            </UButton>
          </div>

          <div
            v-if="showDeleteCloudConfirm"
            id="cloud-delete-confirm"
            class="mt-3.5 max-w-2xl rounded-xl border border-coral-200 bg-coral-50/50 p-3.5 text-sm text-coral-900"
            role="alert"
          >
            <strong>{{ t.deleteCloudTitle }}</strong>
            <p class="my-1.5">{{ t.deleteCloudBody }}</p>
            <p class="my-1.5 font-semibold">{{ t.deleteCloudWarning }}</p>
            <div class="mt-3 flex flex-wrap items-center justify-end gap-2">
              <UButton
                type="button"
                color="neutral"
                variant="ghost"
                size="sm"
                :disabled="deletingCloudData"
                @click="showDeleteCloudConfirm = false"
              >
                {{ t.deleteCloudCancel }}
              </UButton>
              <UButton
                type="button"
                color="error"
                size="sm"
                :loading="deletingCloudData"
                @click="handleDeleteCloudData"
              >
                {{ deletingCloudData ? t.deleteCloudDeleting : t.deleteCloudConfirm }}
              </UButton>
            </div>
          </div>
        </template>

        <template v-else-if="authStep === 'check-email'">
          <p class="mt-3 text-sm text-toned">{{ t.checkEmail }}</p>
        </template>

        <template v-else>
          <form class="mt-3" @submit.prevent="handleSendMagicLink">
            <label class="mb-2 block text-sm text-muted" for="auth-email">{{ t.emailLabel }}</label>
            <div class="flex items-center gap-2.5">
              <input
                id="auth-email"
                v-model="emailInput"
                type="email"
                required
                autocomplete="email"
                class="field flex-1"
              />
              <UButton type="submit" size="sm" :loading="authStep === 'sending'">
                {{ t.sendMagicLink }}
              </UButton>
            </div>
            <p v-if="authStep === 'error' && authError" class="mt-2 text-sm text-red-700">
              {{ t.authError }}: {{ authError }}
            </p>
          </form>
        </template>
      </section>

      <!-- Guest merge prompt modal -->
      <div
        v-if="showMergePrompt"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
        role="dialog"
        :aria-label="t.guestMergeTitle"
      >
        <div class="surface w-full max-w-[480px] p-5 sm:p-6">
          <h2 class="mb-2.5 text-lg font-extrabold text-highlighted">{{ t.guestMergeTitle }}</h2>
          <p class="mb-4 text-sm text-muted">{{ t.guestMergeBody }}</p>
          <div class="flex flex-wrap gap-2.5">
            <UButton type="button" size="sm" @click="handleGuestMerge('merge')">
              {{ t.guestMergeYes }}
            </UButton>
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              size="sm"
              @click="handleGuestMerge('keep')"
            >
              {{ t.guestMergeNo }}
            </UButton>
          </div>
        </div>
      </div>

      <section class="entry-grid grid grid-cols-1 gap-[18px] md:grid-cols-[1.7fr_1fr]" aria-label="Data entry">
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
        class="mt-[18px]"
      />

      <p class="mx-auto my-3 w-[min(700px,100%)] text-center text-[11px] text-dimmed">{{ t.disclaimer }}</p>

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
        class="mt-[18px]"
        @save-feed="saveFeed"
        @remove-feed="removeFeed"
        @save-weight="saveWeight"
        @remove-weight="removeWeight"
      />
    </main>
  </template>
</template>
