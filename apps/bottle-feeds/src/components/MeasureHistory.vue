<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import UButton from '@nuxt/ui/components/Button.vue'
import UModal from '@nuxt/ui/components/Modal.vue'
import UScrollArea from '@nuxt/ui/components/ScrollArea.vue'
import UTabs from '@nuxt/ui/components/Tabs.vue'
import UTree from '@nuxt/ui/components/Tree.vue'
import type { Messages } from '../i18n'
import type { Feed, Weight } from '../types'
import { formatDate, formatDateOnly } from '../utils/format'
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
}>()

const measureTab = ref<'feeds' | 'weights'>('feeds')
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
  emit('save-feed', { id: feed.id, amount, occurredAt: recordedAt, comment: editingFeed.comment.trim() })
  editingFeedId.value = null
}

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
  <section class="measure-card border border-border-light rounded-[18px] bg-white shadow-[0_5px_22px_rgba(45,72,62,0.05)] mt-4 p-5" :aria-label="t.measures">
    <h2 class="m-0 text-[19px] font-extrabold">{{ t.measures }}</h2>
    <UTabs
      v-model="measureTab"
      class="mt-4"
      :items="tabItems"
    >
      <template #feeds>
        <p v-if="!feeds.length" class="empty-state my-7 text-[#919b97] text-[13px] text-center">{{ t.emptyHistory }}</p>
        <UScrollArea v-else class="max-h-[min(32rem,60vh)]" shadow>
          <UTree :items="feedTreeItems" :get-key="(item) => item.id" class="pr-2">
            <template #item-wrapper="{ item, expanded }">
              <button
                v-if="item.kind === 'day'"
                class="measure-day-button flex items-center gap-2 w-full border-0 rounded-lg px-2.5 py-2 text-[#45534f] bg-[#f5f8f6] font-bold text-left cursor-pointer hover:bg-[#edf3ef]"
                type="button"
                :aria-expanded="expanded"
              >
                <span class="w-4 text-[#6f8179] text-center" aria-hidden="true">{{ expanded ? '⌄' : '›' }}</span>
                {{ item.label }}
              </button>
              <div v-else-if="item.feed" class="measure-tree-entry grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 items-center w-full px-2 py-2.5 pl-8 border-b border-[#edf0ee] max-md:grid-cols-[minmax(0,1fr)_auto]">
                <form v-if="editingFeedId === item.feed.id" class="grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-center col-span-full max-md:grid-cols-1" @submit.prevent="saveFeed(item.feed)">
                  <div class="grid grid-cols-[repeat(auto-fit,minmax(100px,1fr))] gap-2 max-md:grid-cols-1">
                    <label class="flex flex-col gap-1.5 text-[#56635f] text-[13px] font-semibold" for="edit-feed-amount">
                      {{ t.amount }}
                      <input id="edit-feed-amount" v-model="editingFeed.amount" type="number" min="1" max="2000" required class="w-full border border-[#d9e1dd] rounded-[10px] px-2 py-2 text-text-primary bg-[#fbfcfb] outline-none" />
                    </label>
                    <label class="flex flex-col gap-1.5 text-[#56635f] text-[13px] font-semibold" for="edit-feed-date">
                      {{ t.date }}
                      <input id="edit-feed-date" v-model="editingFeed.date" type="date" required class="w-full border border-[#d9e1dd] rounded-[10px] px-2 py-2 text-text-primary bg-[#fbfcfb] outline-none" />
                    </label>
                    <label class="flex flex-col gap-1.5 text-[#56635f] text-[13px] font-semibold" for="edit-feed-time">
                      {{ t.time }}
                      <input
                        id="edit-feed-time"
                        :value="editingFeed.time"
                        type="text"
                        inputmode="numeric"
                        :pattern="timePattern.source"
                        placeholder="14:30"
                        maxlength="5"
                        required
                        class="w-full border border-[#d9e1dd] rounded-[10px] px-2 py-2 text-text-primary bg-[#fbfcfb] outline-none"
                        @input="onEditingFeedTimeInput"
                      />
                    </label>
                    <label class="flex flex-col gap-1.5 text-[#56635f] text-[13px] font-semibold" for="edit-feed-comment">
                      {{ t.comment }}
                      <input id="edit-feed-comment" v-model="editingFeed.comment" type="text" maxlength="160" class="w-full border border-[#d9e1dd] rounded-[10px] px-2 py-2 text-text-primary bg-[#fbfcfb] outline-none" />
                    </label>
                  </div>
                  <div class="flex gap-2 max-md:justify-end">
                    <UButton type="submit" color="neutral" variant="soft" size="xs">{{ t.save }}</UButton>
                    <UButton type="button" color="neutral" variant="ghost" size="xs" @click="editingFeedId = null">
                      {{ t.cancel }}
                    </UButton>
                  </div>
                </form>
                <template v-else>
                  <div class="flex min-w-0 gap-2.5 items-baseline flex-wrap">
                    <strong class="text-sm">{{ item.feed.amount }} {{ t.ml }}</strong>
                    <span class="text-[#83908b] text-[11px]">{{ formatDate(item.feed.occurredAt, locale) }}</span>
                    <small v-if="item.feed.comment" class="text-[#83908b] text-[11px]">{{ item.feed.comment }}</small>
                  </div>
                  <UButton type="button" color="neutral" variant="soft" size="xs" @click="editFeed(item.feed)">
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
                </template>
              </div>
            </template>
          </UTree>
        </UScrollArea>
      </template>
      <template #weights>
        <p v-if="!weights.length" class="empty-state my-7 text-[#919b97] text-[13px] text-center">{{ t.emptyWeights }}</p>
        <UScrollArea v-else class="max-h-[min(32rem,60vh)]" shadow>
          <UTree :items="weightTreeItems" :get-key="(item) => item.id" class="pr-2">
            <template #item-wrapper="{ item, expanded }">
              <button
                v-if="item.kind === 'day'"
                class="measure-day-button flex items-center gap-2 w-full border-0 rounded-lg px-2.5 py-2 text-[#45534f] bg-[#f5f8f6] font-bold text-left cursor-pointer hover:bg-[#edf3ef]"
                type="button"
                :aria-expanded="expanded"
              >
                <span class="w-4 text-[#6f8179] text-center" aria-hidden="true">{{ expanded ? '⌄' : '›' }}</span>
                {{ item.label }}
              </button>
              <div v-else-if="item.weight" class="measure-tree-entry grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 items-center w-full px-2 py-2.5 pl-8 border-b border-[#edf0ee] max-md:grid-cols-[minmax(0,1fr)_auto]">
                <form v-if="editingWeightId === item.weight.id" class="grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-center col-span-full max-md:grid-cols-1" @submit.prevent="saveWeight(item.weight)">
                  <div class="grid grid-cols-[repeat(auto-fit,minmax(100px,1fr))] gap-2 max-md:grid-cols-1">
                    <label class="flex flex-col gap-1.5 text-[#56635f] text-[13px] font-semibold" for="edit-weight-kilograms">
                      {{ t.weight }}
                      <input id="edit-weight-kilograms" v-model="editingWeight.kilograms" type="number" min="0.1" max="50" step="0.01" required class="w-full border border-[#d9e1dd] rounded-[10px] px-2 py-2 text-text-primary bg-[#fbfcfb] outline-none" />
                    </label>
                    <label class="flex flex-col gap-1.5 text-[#56635f] text-[13px] font-semibold" for="edit-weight-date">
                      {{ t.date }}
                      <input id="edit-weight-date" v-model="editingWeight.date" type="date" required class="w-full border border-[#d9e1dd] rounded-[10px] px-2 py-2 text-text-primary bg-[#fbfcfb] outline-none" />
                    </label>
                  </div>
                  <div class="flex gap-2 max-md:justify-end">
                    <UButton type="submit" color="neutral" variant="soft" size="xs">{{ t.save }}</UButton>
                    <UButton type="button" color="neutral" variant="ghost" size="xs" @click="editingWeightId = null">
                      {{ t.cancel }}
                    </UButton>
                  </div>
                </form>
                <template v-else>
                  <div class="flex min-w-0 gap-2.5 items-baseline flex-wrap">
                    <strong class="text-sm">{{ item.weight.kilograms.toLocaleString(locale) }} {{ t.kg }}</strong>
                    <span class="text-[#83908b] text-[11px]">{{ formatDateOnly(item.weight.occurredAt, locale) }}</span>
                  </div>
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
