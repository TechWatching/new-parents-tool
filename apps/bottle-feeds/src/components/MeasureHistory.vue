<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import UButton from '@nuxt/ui/components/Button.vue'
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
  return Array.from(days, ([date, children], index) => ({
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
</script>

<template>
  <section class="card measure-card" :aria-label="t.measures">
    <h2>{{ t.measures }}</h2>
    <UTabs
      v-model="measureTab"
      class="measure-tabs"
      :items="tabItems"
    >
      <template #feeds>
        <p v-if="!feeds.length" class="empty-state">{{ t.emptyHistory }}</p>
        <UScrollArea v-else class="measure-scroll-area" shadow>
          <UTree :items="feedTreeItems" :get-key="(item) => item.id" class="measure-tree">
            <template #item-wrapper="{ item, expanded, handleToggle }">
              <button
                v-if="item.kind === 'day'"
                class="measure-day-button"
                type="button"
                :aria-expanded="expanded"
                @click="handleToggle"
              >
                <span aria-hidden="true">{{ expanded ? '⌄' : '›' }}</span>
                {{ item.label }}
              </button>
              <div v-else-if="item.feed" class="measure-tree-entry">
                <form v-if="editingFeedId === item.feed.id" @submit.prevent="saveFeed(item.feed)">
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
                        :value="editingFeed.time"
                        type="text"
                        inputmode="numeric"
                        :pattern="timePattern.source"
                        placeholder="14:30"
                        maxlength="5"
                        required
                        @input="onEditingFeedTimeInput"
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
                <template v-else>
                  <div class="measure-details">
                    <strong>{{ item.feed.amount }} {{ t.ml }}</strong>
                    <span>{{ formatDate(item.feed.occurredAt, locale) }}</span>
                    <small v-if="item.feed.comment">{{ item.feed.comment }}</small>
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
                    @click="emit('remove-feed', item.feed.id)"
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
        <p v-if="!weights.length" class="empty-state">{{ t.emptyWeights }}</p>
        <UScrollArea v-else class="measure-scroll-area" shadow>
          <UTree :items="weightTreeItems" :get-key="(item) => item.id" class="measure-tree">
            <template #item-wrapper="{ item, expanded, handleToggle }">
              <button
                v-if="item.kind === 'day'"
                class="measure-day-button"
                type="button"
                :aria-expanded="expanded"
                @click="handleToggle"
              >
                <span aria-hidden="true">{{ expanded ? '⌄' : '›' }}</span>
                {{ item.label }}
              </button>
              <div v-else-if="item.weight" class="measure-tree-entry">
                <form v-if="editingWeightId === item.weight.id" @submit.prevent="saveWeight(item.weight)">
                  <div class="measure-fields">
                    <label for="edit-weight-kilograms">
                      {{ t.weight }}
                      <input id="edit-weight-kilograms" v-model="editingWeight.kilograms" type="number" min="0.1" max="50" step="0.01" required />
                    </label>
                    <label for="edit-weight-date">
                      {{ t.date }}
                      <input id="edit-weight-date" v-model="editingWeight.date" type="date" required />
                    </label>
                  </div>
                  <div class="measure-actions">
                    <UButton type="submit" size="xs">{{ t.save }}</UButton>
                    <UButton type="button" color="neutral" variant="ghost" size="xs" @click="editingWeightId = null">
                      {{ t.cancel }}
                    </UButton>
                  </div>
                </form>
                <template v-else>
                  <div class="measure-details">
                    <strong>{{ item.weight.kilograms.toLocaleString(locale) }} {{ t.kg }}</strong>
                    <span>{{ formatDateOnly(item.weight.occurredAt, locale) }}</span>
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
                    @click="emit('remove-weight', item.weight.id)"
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
  </section>
</template>
