<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import UButton from '@nuxt/ui/components/Button.vue'
import UModal from '@nuxt/ui/components/Modal.vue'
import UScrollArea from '@nuxt/ui/components/ScrollArea.vue'
import UTabs from '@nuxt/ui/components/Tabs.vue'
import UTree from '@nuxt/ui/components/Tree.vue'
import type { Messages } from '../i18n'
import type { Feed, Weight } from '../types'
import { formatDate, formatDateOnly, formatTime } from '../utils/format'
import { dateFromOccurredAt, dateOnlyOccurredAt, dateTimeFromOccurredAt, maskTimeInput, occurredAt, timePattern } from '../utils/time'

const props = defineProps<{
  feeds: Feed[]
  weights: Weight[]
  t: Messages
  locale: string
}>()

const emit = defineEmits<{
  'save-feed': [payload: { id: string; amount: number; occurredAt: string; comment: string }]
  'remove-feed': [id: string]
  'save-weight': [payload: { id: string; kilograms: number; occurredAt: string }]
  'remove-weight': [id: string]
  'editing-change': [editing: boolean]
}>()

const measureTab = ref<'feeds' | 'weights'>('feeds')
const rootRef = ref<HTMLElement | null>(null)
const tabItems = computed(() => [
  { label: props.t.quantities, value: 'feeds', slot: 'feeds' },
  { label: props.t.weights, value: 'weights', slot: 'weights' },
])

type MeasureTreeItem = {
  id: string
  label: string
  kind: 'day' | 'feed' | 'weight'
  defaultExpanded?: boolean
  children?: MeasureTreeItem[]
  feed?: Feed
  weight?: Weight
}

function dayLabel(date: string) {
  return new Intl.DateTimeFormat(props.locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${date}T12:00:00`))
}

function groupByDay(items: MeasureTreeItem[]) {
  const days = new Map<string, MeasureTreeItem[]>()
  for (const item of items) {
    const occurredAt = item.feed?.occurredAt ?? item.weight?.occurredAt
    if (!occurredAt) continue
    const date = dateFromOccurredAt(occurredAt)
    const entries = days.get(date) ?? []
    entries.push(item)
    days.set(date, entries)
  }
  return Array.from(days)
    .sort(([dateA], [dateB]) => dateB.localeCompare(dateA))
    .map(([date, children], index) => ({
      id: `day-${date}`,
      label: dayLabel(date),
      kind: 'day' as const,
      defaultExpanded: index === 0,
      children,
    }))
}

const feedTreeItems = computed<MeasureTreeItem[]>(() =>
  groupByDay(props.feeds.map((feed) => ({
    id: feed.id,
    label: `${feed.amount} ${props.t.ml}`,
    kind: 'feed' as const,
    feed,
  }))),
)

const weightTreeItems = computed<MeasureTreeItem[]>(() =>
  groupByDay(props.weights.map((weight) => ({
    id: weight.id,
    label: `${weight.kilograms.toLocaleString(props.locale)} ${props.t.kg}`,
    kind: 'weight' as const,
    weight,
  }))),
)

// ---------------------------------------------------------------------------
// Inline edit buffers (ephemeral UI state) — the actual data mutation is
// delegated to the parent via the `save-feed` / `save-weight` events.
// ---------------------------------------------------------------------------

const editingFeedId = ref<string | null>(null)
const editingFeed = reactive({ amount: '', date: '', time: '', comment: '' })
const editingWeightId = ref<string | null>(null)
const editingWeight = reactive({ kilograms: '', date: '' })
watch(
  [editingFeedId, editingWeightId],
  ([feedId, weightId]) => emit('editing-change', !!feedId || !!weightId),
  { flush: 'sync' },
)
const deleteDialogOpen = ref(false)
const pendingDeletion = ref<{
  id: string
  kind: 'feed' | 'weight'
  measure: string
  date: string
} | null>(null)

function onTimeInput(form: { time: string }, event: Event) {
  maskTimeInput(event, (value) => {
    form.time = value
  })
}

function onEditingFeedTimeInput(event: Event) {
  onTimeInput(editingFeed, event)
}

function beginEditFeed(feed: Feed) {
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
  emit('save-feed', { id: feed.id, amount, occurredAt: recordedAt, comment: editingFeed.comment.trim() })
  editingFeedId.value = null
}

/** Opens inline editing for a feed and scrolls it into view. Exposed for App.vue's "edit latest bottle" shortcut. */
async function editFeed(feedId: string) {
  const feed = props.feeds.find((candidate) => candidate.id === feedId)
  if (!feed) return
  measureTab.value = 'feeds'
  beginEditFeed(feed)
  await nextTick()
  const entry = Array.from(
    rootRef.value?.querySelectorAll<HTMLElement>('[data-feed-entry-id]') ?? [],
  ).find((element) => element.dataset.feedEntryId === feedId)
  entry?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
}

defineExpose({ editFeed })

function editWeight(weight: Weight) {
  editingWeightId.value = weight.id
  Object.assign(editingWeight, {
    kilograms: String(weight.kilograms),
    date: dateFromOccurredAt(weight.occurredAt),
  })
}

function saveWeight(weight: Weight) {
  const kilograms = Number(editingWeight.kilograms)
  const recordedAt = dateOnlyOccurredAt(editingWeight.date)
  if (!kilograms || kilograms <= 0 || !recordedAt) return
  emit('save-weight', { id: weight.id, kilograms, occurredAt: recordedAt })
  editingWeightId.value = null
}

function requestFeedDeletion(feed: Feed) {
  pendingDeletion.value = {
    id: feed.id,
    kind: 'feed',
    measure: `${feed.amount} ${props.t.ml}`,
    date: formatDate(feed.occurredAt, props.locale),
  }
  deleteDialogOpen.value = true
}

function requestWeightDeletion(weight: Weight) {
  pendingDeletion.value = {
    id: weight.id,
    kind: 'weight',
    measure: `${weight.kilograms.toLocaleString(props.locale)} ${props.t.kg}`,
    date: formatDateOnly(weight.occurredAt, props.locale),
  }
  deleteDialogOpen.value = true
}

function closeDeleteDialog() {
  deleteDialogOpen.value = false
  pendingDeletion.value = null
}

function confirmDeletion() {
  if (!pendingDeletion.value) return
  const { id, kind } = pendingDeletion.value
  if (kind === 'feed') emit('remove-feed', id)
  else emit('remove-weight', id)
  closeDeleteDialog()
}

const deleteDialogDescription = computed(() => {
  if (!pendingDeletion.value) return ''
  return props.t.deleteMeasureBody
    .replace('{measure}', pendingDeletion.value.measure)
    .replace('{date}', pendingDeletion.value.date)
})
</script>

<template>
  <section ref="rootRef" class="measure-card surface mt-[18px] p-5 sm:p-6" :aria-label="t.measures">
    <h2 class="text-lg font-extrabold text-highlighted">{{ t.measures }}</h2>
    <UTabs
      v-model="measureTab"
      class="mt-4"
      :items="tabItems"
    >
      <template #feeds>
        <p v-if="!feeds.length" class="empty-state mb-3 mt-7 text-center text-sm text-dimmed">{{ t.emptyHistory }}</p>
        <UScrollArea v-else class="max-h-[min(32rem,60vh)]" shadow>
          <UTree :items="feedTreeItems" :get-key="(item) => item.id" class="pr-2">
            <template #item-wrapper="{ item, expanded }">
              <button
                v-if="item.kind === 'day'"
                class="measure-day-button flex w-full items-center gap-2 rounded-lg bg-sage-50 px-2.5 py-2.5 text-left font-bold text-toned transition-colors hover:bg-sage-100"
                type="button"
                :aria-expanded="expanded"
              >
                <span class="w-4 text-center text-muted" aria-hidden="true">{{ expanded ? '⌄' : '›' }}</span>
                {{ item.label }}
              </button>
              <div
                v-else-if="item.feed"
                class="measure-tree-entry tree-entry"
                :data-feed-entry-id="item.feed.id"
              >
                <form v-if="editingFeedId === item.feed.id" class="col-span-full grid grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto]" @submit.prevent="saveFeed(item.feed)">
                  <div class="grid grid-cols-1 gap-2">
                    <label class="flex flex-col gap-2 text-sm font-semibold text-toned" for="edit-feed-amount">
                      {{ t.amount }}
                      <input id="edit-feed-amount" v-model="editingFeed.amount" class="field py-2" type="number" min="1" max="2000" required />
                    </label>
                    <label class="flex flex-col gap-2 text-sm font-semibold text-toned" for="edit-feed-date">
                      {{ t.date }}
                      <input id="edit-feed-date" v-model="editingFeed.date" class="field py-2" type="date" required />
                    </label>
                    <label class="flex flex-col gap-2 text-sm font-semibold text-toned" for="edit-feed-time">
                      {{ t.time }}
                      <input
                        id="edit-feed-time"
                        :value="editingFeed.time"
                        class="field py-2"
                        type="text"
                        inputmode="numeric"
                        :pattern="timePattern.source"
                        placeholder="14:30"
                        maxlength="5"
                        required
                        @input="onEditingFeedTimeInput"
                      />
                    </label>
                    <label class="flex flex-col gap-2 text-sm font-semibold text-toned" for="edit-feed-comment">
                      {{ t.comment }}
                      <input id="edit-feed-comment" v-model="editingFeed.comment" class="field py-2" type="text" maxlength="160" />
                    </label>
                  </div>
                  <div class="flex gap-2 max-sm:justify-end">
                    <UButton type="submit" color="neutral" variant="soft" size="xs">{{ t.save }}</UButton>
                    <UButton type="button" color="neutral" variant="ghost" size="xs" @click="editingFeedId = null">
                      {{ t.cancel }}
                    </UButton>
                  </div>
                </form>
                <template v-else>
                  <div class="flex min-w-0 flex-wrap items-baseline gap-2.5">
                    <strong class="text-sm font-bold text-highlighted">{{ item.feed.amount }} {{ t.ml }}</strong>
                    <span class="text-[11px] text-muted">{{ formatTime(item.feed.occurredAt, locale) }}</span>
                    <small v-if="item.feed.comment" class="text-[11px] text-muted">{{ item.feed.comment }}</small>
                  </div>
                  <div class="flex gap-2 max-sm:justify-end sm:contents">
                    <UButton type="button" color="neutral" variant="soft" size="xs" @click="beginEditFeed(item.feed)">
                      {{ t.edit }}
                    </UButton>
                    <UButton
                      type="button"
                      color="error"
                      variant="soft"
                      size="xs"
                      :aria-label="`${t.delete} ${item.feed.amount} ${t.ml}`"
                      @click="requestFeedDeletion(item.feed)"
                    >
                      {{ t.delete }}
                    </UButton>
                  </div>
                </template>
              </div>
            </template>
          </UTree>
        </UScrollArea>
      </template>
      <template #weights>
        <p v-if="!weights.length" class="empty-state mb-3 mt-7 text-center text-sm text-dimmed">{{ t.emptyWeights }}</p>
        <UScrollArea v-else class="max-h-[min(32rem,60vh)]" shadow>
          <UTree :items="weightTreeItems" :get-key="(item) => item.id" class="pr-2">
            <template #item-wrapper="{ item, expanded }">
              <button
                v-if="item.kind === 'day'"
                class="measure-day-button flex w-full items-center gap-2 rounded-lg bg-sage-50 px-2.5 py-2.5 text-left font-bold text-toned transition-colors hover:bg-sage-100"
                type="button"
                :aria-expanded="expanded"
              >
                <span class="w-4 text-center text-muted" aria-hidden="true">{{ expanded ? '⌄' : '›' }}</span>
                {{ item.label }}
              </button>
              <div
                v-else-if="item.weight"
                class="measure-tree-entry tree-entry"
              >
                <form v-if="editingWeightId === item.weight.id" class="col-span-full grid grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto]" @submit.prevent="saveWeight(item.weight)">
                  <div class="grid grid-cols-1 gap-2">
                    <label class="flex flex-col gap-2 text-sm font-semibold text-toned" for="edit-weight-kilograms">
                      {{ t.weight }}
                      <input id="edit-weight-kilograms" v-model="editingWeight.kilograms" class="field py-2" type="number" min="0.1" max="50" step="0.01" required />
                    </label>
                    <label class="flex flex-col gap-2 text-sm font-semibold text-toned" for="edit-weight-date">
                      {{ t.date }}
                      <input id="edit-weight-date" v-model="editingWeight.date" class="field py-2" type="date" required />
                    </label>
                  </div>
                  <div class="flex gap-2 max-sm:justify-end">
                    <UButton type="submit" color="neutral" variant="soft" size="xs">{{ t.save }}</UButton>
                    <UButton type="button" color="neutral" variant="ghost" size="xs" @click="editingWeightId = null">
                      {{ t.cancel }}
                    </UButton>
                  </div>
                </form>
                <template v-else>
                  <div class="flex min-w-0 flex-wrap items-baseline gap-2.5">
                    <strong class="text-sm font-bold text-highlighted">{{ item.weight.kilograms.toLocaleString(locale) }} {{ t.kg }}</strong>
                  </div>
                  <div class="flex gap-2 max-sm:justify-end sm:contents">
                    <UButton type="button" color="neutral" variant="soft" size="xs" @click="editWeight(item.weight)">
                      {{ t.edit }}
                    </UButton>
                    <UButton
                      type="button"
                      color="error"
                      variant="soft"
                      size="xs"
                      :aria-label="`${t.delete} ${item.weight.kilograms} ${t.kg}`"
                      @click="requestWeightDeletion(item.weight)"
                    >
                      {{ t.delete }}
                    </UButton>
                  </div>
                </template>
              </div>
            </template>
          </UTree>
        </UScrollArea>
      </template>
    </UTabs>

    <UModal
      v-model:open="deleteDialogOpen"
      :title="t.deleteMeasureTitle"
      :description="deleteDialogDescription"
      :close="false"
      @after:leave="pendingDeletion = null"
    >
      <template #footer>
        <UButton type="button" color="neutral" variant="ghost" @click="closeDeleteDialog">
          {{ t.cancel }}
        </UButton>
        <UButton type="button" color="error" variant="soft" @click="confirmDeletion">
          {{ t.deleteMeasureConfirm }}
        </UButton>
      </template>
    </UModal>
  </section>
</template>
