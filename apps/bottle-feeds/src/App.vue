<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useTimeoutFn } from '@vueuse/core'
import UButton from '@nuxt/ui/components/Button.vue'
import ULocaleSelect from '@nuxt/ui/components/locale/LocaleSelect.vue'
import { useToast } from '@nuxt/ui/composables/useToast'
import { messages, type Language } from './i18n'
import { loadData, GUEST_NAMESPACE, type Namespace } from './storage'
import { syncStatus, syncError, lastSyncedAt } from './sync'
import { useAppData } from './composables/useAppData'
import { useOfflineAvailability } from './composables/useOfflineAvailability'
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
import { formatDate, formatDateOnly, formatRelativeTime } from './utils/format'
import FeedForm from './components/FeedForm.vue'
import WeightForm from './components/WeightForm.vue'
import SummaryMetrics from './components/SummaryMetrics.vue'
import TrendsCharts from './components/TrendsCharts.vue'
import MeasureHistory from './components/MeasureHistory.vue'
import ReportGenerator from './components/ReportGenerator.vue'
import CloudSharingPanel from './components/sharing/CloudSharingPanel.vue'
import SyncConflictPanel from './components/sharing/SyncConflictPanel.vue'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const {
  data,
  currentNamespace,
  loading,
  loadError,
  saveError,
  saving,
  exclusive,
  commit,
  retrySave,
  flush,
  triggerSync,
  captureIdentity,
  reload,
  backendAvailable,
  cloudUser,
  family,
  sharingEnabled,
  needsResume,
  cloudBusy,
  cloudError,
  invitation,
  pendingInvitation,
  pendingCount,
  conflicts,
  signIn,
  signOut,
  createFamily,
  acceptInvitation,
  createInvitation,
  revokeInvitation,
  leaveFamily,
  removePartner,
  deleteFamily,
  resumeSharing,
  resolveConflict,
  exportBackup,
  importBackup,
  pendingImportNamespace,
  clearPendingImport,
} = useAppData()
const { ready: offlineReady, updateAvailable, error: offlineError, applyUpdate } = useOfflineAvailability()
const productionBuild = import.meta.env.PROD
const logoUrl = `${import.meta.env.BASE_URL}favicon.svg`
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
const privacyPolicyUrl = computed(
  () => `${import.meta.env.BASE_URL}privacy.html#${language.value === 'fr' ? 'fr' : 'en'}`,
)
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
const historyEditing = ref(false)
const sharingPanelOpen = ref(false)
const hasOpenDraft = computed(() => !!(feedForm.amount || feedForm.comment || weightForm.kilograms || historyEditing.value))

// Guest merge prompt
const showMergePrompt = ref(false)
const guestDataForMerge = ref<AppData | null>(null)
const mergeSourceForPrompt = ref<Namespace | null>(null)
const guestMergeRef = ref<HTMLElement | null>(null)
const mergingGuest = ref(false)

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
// Initialization and identity-specific prompts
// ---------------------------------------------------------------------------

onMounted(() => {
  nowIntervalId = window.setInterval(() => {
    now.value = Date.now()
  }, 60_000)
})

watch(loading, (value) => {
  if (!value && !loadError.value) defaultToRecentEntryDate()
})

watch(showMergePrompt, async (value) => {
  if (!value) return
  await nextTick()
  guestMergeRef.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
})

watch(currentNamespace, () => {
  historyEditing.value = false
  Object.assign(feedForm, { amount: '', ...dateTimeForInput(), comment: '' })
  Object.assign(weightForm, { kilograms: '', date: dateTimeForInput().date })
}, { flush: 'sync' })

watch(
  [currentNamespace, sharingEnabled, pendingImportNamespace, loading],
  async ([ns, enabled, pendingImport, isLoading], _previous, onCleanup) => {
    let cancelled = false
    onCleanup(() => { cancelled = true })
    showMergePrompt.value = false
    guestDataForMerge.value = null
    mergeSourceForPrompt.value = null
    if (ns === GUEST_NAMESPACE || !enabled || isLoading) return
    const identity = captureIdentity()
    const source = pendingImport ?? GUEST_NAMESPACE
    try {
      const guest = await loadData(source)
      if (
        !cancelled && identity.isCurrent() &&
        (guest.feeds.some((f) => !f.deletedAt) || guest.weights.some((w) => !w.deletedAt))
      ) {
        guestDataForMerge.value = guest
        mergeSourceForPrompt.value = source
        showMergePrompt.value = true
      }
    } catch {
      if (!cancelled && identity.isCurrent()) toast.add({ title: t.value.storageLoadError, color: 'error' })
    }
  },
  { flush: 'sync' },
)

onUnmounted(() => {
  if (nowIntervalId !== undefined) {
    window.clearInterval(nowIntervalId)
  }
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

async function addFeed() {
  const amount = Number(feedForm.amount)
  const recordedAt = occurredAt(feedForm.date, feedForm.time)
  if (!amount || amount <= 0 || !recordedAt) return
  const now = new Date().toISOString()
  const saved = commit((draft) =>
    draft.feeds.unshift({
      id: makeId(),
      amount,
      occurredAt: recordedAt,
      comment: feedForm.comment.trim(),
      updatedAt: now,
    }),
  )
  feedForm.amount = ''
  feedForm.comment = ''
  applyEntryDateWithReset(recordedAt)
  if (!(await saved)) return
  toast.add({
    title: t.value.feedAdded,
    description: `${amount.toLocaleString(locale.value)} ${t.value.ml} · ${formatDate(recordedAt, locale.value)}`,
    color: 'success',
  })
}

async function addWeight() {
  const kilograms = Number(weightForm.kilograms)
  const recordedAt = dateOnlyOccurredAt(weightForm.date)
  if (!kilograms || kilograms <= 0 || !recordedAt) return
  const now = new Date().toISOString()
  const saved = commit((draft) =>
    draft.weights.unshift({
      id: makeId(),
      kilograms,
      occurredAt: recordedAt,
      updatedAt: now,
    }),
  )
  weightForm.kilograms = ''
  applyEntryDateWithReset(recordedAt)
  if (!(await saved)) return
  toast.add({
    title: t.value.weightAdded,
    description: `${kilograms.toLocaleString(locale.value)} ${t.value.kg} · ${formatDateOnly(recordedAt, locale.value)}`,
    color: 'success',
  })
}

function saveFeed(payload: { id: string; amount: number; occurredAt: string; comment: string }) {
  void commit((draft) => {
    const target = draft.feeds.find((f) => f.id === payload.id)
    if (target) Object.assign(target, payload, { updatedAt: nextUpdatedAt(target.updatedAt) })
  })
}

function saveWeight(payload: { id: string; kilograms: number; occurredAt: string }) {
  void commit((draft) => {
    const target = draft.weights.find((w) => w.id === payload.id)
    if (target) Object.assign(target, payload, { updatedAt: nextUpdatedAt(target.updatedAt) })
  })
}

function nextUpdatedAt(previous: string) {
  return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString()
}

function removeFeed(id: string) {
  void commit((draft) => {
    const target = draft.feeds.find((f) => f.id === id)
    if (target) target.deletedAt = target.updatedAt = nextUpdatedAt(target.updatedAt)
  })
}

function removeWeight(id: string) {
  void commit((draft) => {
    const target = draft.weights.find((w) => w.id === id)
    if (target) target.deletedAt = target.updatedAt = nextUpdatedAt(target.updatedAt)
  })
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
const measureHistoryRef = ref<InstanceType<typeof MeasureHistory> | null>(null)
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

function quickEditLatestFeed() {
  const feed = latestFeed.value
  if (!feed) return
  void measureHistoryRef.value?.editFeed(feed.id)
}

// ---------------------------------------------------------------------------
// Export / Import
// ---------------------------------------------------------------------------

async function exportData() {
  try {
    const snapshot = await exportBackup()
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
  } catch {
    toast.add({ title: t.value.sharingBackupError, color: 'error' })
  }
}

function triggerImport() {
  importFileRef.value?.click()
}

async function handleImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (hasOpenDraft.value) {
    toast.add({ title: t.value.sharingFinishDraft, color: 'warning' })
    input.value = ''
    return
  }
  const identity = captureIdentity()
  try {
    const text = await file.text()
    const imported: unknown = JSON.parse(text)
    if (!identity.isCurrent()) throw new Error('The import identity changed')
    if (!(await importBackup(imported))) throw new Error('The backup could not be restored')
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
  const guest = guestDataForMerge.value
  const source = mergeSourceForPrompt.value
  if (mergingGuest.value) return
  mergingGuest.value = true
  try {
    if (action === 'merge' && guest) {
      if (sharingEnabled.value && navigator.onLine) await triggerSync()
      const committed = await commit((draft) => Object.assign(draft, mergeAppData(draft, guest)))
      if (!committed) return
    }
    if (source && source !== GUEST_NAMESPACE) await clearPendingImport(source)
    showMergePrompt.value = false
    guestDataForMerge.value = null
    mergeSourceForPrompt.value = null
    if (action === 'merge' && sharingEnabled.value && navigator.onLine) void triggerSync()
  } catch {
    toast.add({ title: t.value.storageSaveError, color: 'error' })
  } finally {
    mergingGuest.value = false
  }
}

// ---------------------------------------------------------------------------
// Safe app updates
// ---------------------------------------------------------------------------

async function updateApp() {
  if (hasOpenDraft.value) {
    toast.add({ title: t.value.offlineUpdateDraft, color: 'warning' })
    return
  }
  if (!(await flush())) return
  await applyUpdate()
}

async function changeIdentity(action: () => Promise<unknown>) {
  if (hasOpenDraft.value) {
    toast.add({ title: t.value.sharingFinishDraft, color: 'warning' })
    return
  }
  await action()
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
    <span class="inline-block text-2xl text-coral-500 motion-safe:animate-spin" aria-hidden="true"
      >◒</span
    >
    <span>{{ t.loading }}</span>
  </div>

  <div v-else-if="loadError" class="mx-auto max-w-2xl p-6" role="alert">
    <p>{{ t.storageLoadError }}</p>
    <UButton class="mt-3" color="neutral" variant="outline" @click="reload">
      {{ t.syncRetry }}
    </UButton>
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
          <img
            :src="logoUrl"
            alt=""
            width="34"
            height="34"
            class="size-[34px] shrink-0 rounded-[9px]"
            data-testid="brand-mark"
          />
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
      <div
        v-if="saveError"
        class="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        role="alert"
      >
        <p>{{ t.storageSaveError }}</p>
        <UButton
          class="mt-2"
          color="neutral"
          variant="outline"
          :loading="saving"
          @click="retrySave"
        >
          {{ t.storageRetry }}
        </UButton>
      </div>
      <div class="mb-[18px] text-center text-[13px] text-muted">
        <span class="font-bold text-mint-600" aria-hidden="true">⌁</span>
        {{ family ? t.sharingFamily : t.sharingLocal }}
        <span aria-hidden="true"> · </span>
        <a
          class="font-medium text-coral-800 underline underline-offset-2 hover:text-coral-900 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-700"
          :href="privacyPolicyUrl"
        >{{ t.privacyPolicy }}</a>
      </div>
      <div v-if="productionBuild" class="mb-4 text-center text-xs text-muted">
        <p role="status">{{ offlineError ? t.offlineError : offlineReady ? t.offlineReady : t.offlinePreparing }}</p>
        <p class="mt-1">{{ t.offlineLimit }}</p>
        <div v-if="updateAvailable" class="mt-2 flex flex-wrap items-center justify-center gap-2">
          <span>{{ t.offlineUpdate }}</span>
          <UButton size="xs" color="neutral" variant="outline" :disabled="saving || exclusive" @click="updateApp">{{ t.offlineApplyUpdate }}</UButton>
        </div>
      </div>

      <p
        v-if="lastBottleSummary"
        class="last-bottle-banner mb-[18px] grid justify-items-center gap-0.5 rounded-full border border-mint-100 bg-mint-50/40 px-4 py-2.5 text-center text-[13px] font-semibold text-mint-800"
        role="status"
        aria-live="polite"
      >
        <span>{{ lastBottleSummary.relativeTime }}</span>
        <span class="flex items-center gap-1 font-medium text-muted">
          <span>{{ lastBottleSummary.details }}</span>
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            size="xs"
            class="h-auto min-h-0 min-w-0 px-1 py-0.5 leading-none"
            :aria-label="t.editLatestBottle"
            :disabled="exclusive"
            @click="quickEditLatestFeed"
          >
            ✎
          </UButton>
        </span>
      </p>

      <!-- Sync status bar -->
      <div
        v-if="family && syncStatus !== 'idle'"
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
          :disabled="exclusive"
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
      <div class="mb-[18px] flex flex-wrap items-stretch gap-2" :inert="exclusive">
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          class="min-w-0 flex-1 basis-0 justify-center whitespace-normal text-center"
          @click="exportData"
        >
          {{ t.exportData }}
        </UButton>
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          class="min-w-0 flex-1 basis-0 justify-center whitespace-normal text-center"
          @click="triggerImport"
        >
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

        <ReportGenerator
          :feeds="activeFeeds"
          :weights="activeWeights"
          :t="t"
          :locale="locale"
          :now="now"
          :conflicts="conflicts"
        />
      </div>

      <section
        v-if="showMergePrompt"
        ref="guestMergeRef"
        class="surface mb-5 p-5 sm:p-6"
        aria-labelledby="guest-merge-heading"
      >
        <h2 id="guest-merge-heading" class="mb-2.5 text-lg font-extrabold text-highlighted">{{ t.guestMergeTitle }}</h2>
        <p class="mb-4 text-sm text-muted">{{ t.guestMergeBody }}</p>
        <div class="flex flex-wrap gap-2.5">
          <UButton type="button" size="sm" :loading="mergingGuest" @click="handleGuestMerge('merge')">
            {{ t.guestMergeYes }}
          </UButton>
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            size="sm"
            :disabled="mergingGuest"
            @click="handleGuestMerge('keep')"
          >
            {{ t.guestMergeNo }}
          </UButton>
        </div>
      </section>

      <CloudSharingPanel
        v-model:open="sharingPanelOpen"
        :available="backendAvailable"
        :user="cloudUser"
        :family="family"
        :enabled="sharingEnabled"
        :needs-resume="needsResume"
        :pending-invitation="pendingInvitation"
        :invitation="invitation"
        :pending-count="pendingCount"
        :busy="cloudBusy || exclusive"
        :error="cloudError"
        :t="t"
        :locale="locale"
        @sign-in="provider => changeIdentity(() => signIn(provider))"
        @sign-out="changeIdentity(signOut)"
        @create="changeIdentity(createFamily)"
        @join="changeIdentity(acceptInvitation)"
        @invite="createInvitation"
        @revoke="revokeInvitation"
        @leave="changeIdentity(leaveFamily)"
        @remove="removePartner"
        @delete="changeIdentity(deleteFamily)"
        @resume="changeIdentity(resumeSharing)"
        @sync="triggerSync"
      />
      <SyncConflictPanel :conflicts="conflicts" :busy="exclusive || saving" :t="t" :locale="locale" @resolve="resolveConflict" />

      <fieldset class="contents" :disabled="exclusive">
        <section
          class="entry-grid grid grid-cols-1 gap-[18px] md:grid-cols-[1.7fr_1fr]"
          aria-label="Data entry"
        >
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
          :now="now"
          :feeds="activeFeeds"
          :latest-weight="latestWeight"
          :daily-guide="dailyGuide"
          :t="t"
          :locale="locale"
          class="mt-[18px]"
        />

        <p class="mx-auto my-3 w-[min(700px,100%)] text-center text-[11px] text-dimmed">
          {{ t.disclaimer }}
        </p>

        <TrendsCharts
          :now="now"
          :feeds="activeFeeds"
          :weights="activeWeights"
          :daily-guide="dailyGuide"
          :t="t"
          :locale="locale"
        />

        <MeasureHistory
          :key="currentNamespace"
          ref="measureHistoryRef"
          :feeds="sortedFeeds"
          :weights="sortedWeights"
          :t="t"
          :locale="locale"
          class="mt-[18px]"
          @save-feed="saveFeed"
          @remove-feed="removeFeed"
          @save-weight="saveWeight"
          @remove-weight="removeWeight"
          @editing-change="historyEditing = $event"
        />
      </fieldset>
    </main>
  </template>
</template>
