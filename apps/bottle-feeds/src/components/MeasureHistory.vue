<script setup lang="ts">
import { reactive, ref } from 'vue'
import UButton from '@nuxt/ui/components/Button.vue'
import UTabs from '@nuxt/ui/components/Tabs.vue'
import type { Messages } from '../i18n'
import type { Feed, Weight } from '../types'
import { formatDate } from '../utils/format'
import { dateTimeFromOccurredAt, maskTimeInput, occurredAt, showDatePicker, timePattern } from '../utils/time'

defineProps<{
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

// ---------------------------------------------------------------------------
// Inline edit buffers (ephemeral UI state) — the actual data mutation is
// delegated to the parent via the `save-feed` / `save-weight` events.
// ---------------------------------------------------------------------------

const editingFeedId = ref<string | null>(null)
const editingFeed = reactive({ amount: '', date: '', time: '', comment: '' })
const editingWeightId = ref<string | null>(null)
const editingWeight = reactive({ kilograms: '', date: '', time: '' })

function onTimeInput(form: { time: string }, event: Event) {
  maskTimeInput(event, (value) => {
    form.time = value
  })
}

function onEditingFeedTimeInput(event: Event) {
  onTimeInput(editingFeed, event)
}

function onEditingWeightTimeInput(event: Event) {
  onTimeInput(editingWeight, event)
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
    ...dateTimeFromOccurredAt(weight.occurredAt),
  })
}

function saveWeight(weight: Weight) {
  const kilograms = Number(editingWeight.kilograms)
  const recordedAt = occurredAt(editingWeight.date, editingWeight.time)
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
      :items="[
        { label: t.quantities, value: 'feeds' },
        { label: t.weights, value: 'weights' },
      ]"
      :content="false"
    />

    <p v-if="measureTab === 'feeds' && !feeds.length" class="empty-state">
      {{ t.emptyHistory }}
    </p>
    <ul v-else-if="measureTab === 'feeds'" class="measure-list">
      <li v-for="feed in feeds" :key="feed.id">
        <template v-if="editingFeedId === feed.id">
          <form @submit.prevent="saveFeed(feed)">
            <div class="measure-fields">
              <label for="edit-feed-amount">
                {{ t.amount }}
                <input id="edit-feed-amount" v-model="editingFeed.amount" type="number" min="1" max="2000" required />
              </label>
              <label for="edit-feed-date">
                {{ t.date }}
                <input
                  id="edit-feed-date"
                  v-model="editingFeed.date"
                  type="date"
                  :lang="locale"
                  required
                  @click="showDatePicker"
                />
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
        </template>
        <template v-else>
          <div>
            <strong>{{ feed.amount }} {{ t.ml }}</strong><span>{{ formatDate(feed.occurredAt, locale) }}</span><small v-if="feed.comment">{{ feed.comment }}</small>
          </div>
          <UButton type="button" color="neutral" variant="soft" size="xs" @click="editFeed(feed)">
            {{ t.edit }}
          </UButton>
          <button class="delete-button" type="button" :aria-label="`${t.delete} ${feed.amount} ${t.ml}`" @click="emit('remove-feed', feed.id)">
            ×
          </button>
        </template>
      </li>
    </ul>

    <p v-else-if="!weights.length" class="empty-state">{{ t.emptyWeights }}</p>
    <ul v-else class="measure-list">
      <li v-for="weight in weights" :key="weight.id">
        <template v-if="editingWeightId === weight.id">
          <form @submit.prevent="saveWeight(weight)">
            <div class="measure-fields">
              <label for="edit-weight-kilograms">
                {{ t.weight }}
                <input id="edit-weight-kilograms" v-model="editingWeight.kilograms" type="number" min="0.1" max="50" step="0.01" required />
              </label>
              <label for="edit-weight-date">
                {{ t.date }}
                <input
                  id="edit-weight-date"
                  v-model="editingWeight.date"
                  type="date"
                  :lang="locale"
                  required
                  @click="showDatePicker"
                />
              </label>
              <label for="edit-weight-time">
                {{ t.time }}
                <input
                  id="edit-weight-time"
                  :value="editingWeight.time"
                  type="text"
                  inputmode="numeric"
                  :pattern="timePattern.source"
                  placeholder="14:30"
                  maxlength="5"
                  required
                  @input="onEditingWeightTimeInput"
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
            <strong>{{ weight.kilograms.toLocaleString(locale) }} {{ t.kg }}</strong><span>{{ formatDate(weight.occurredAt, locale) }}</span>
          </div>
          <UButton type="button" color="neutral" variant="soft" size="xs" @click="editWeight(weight)">
            {{ t.edit }}
          </UButton>
          <button class="delete-button" type="button" :aria-label="`${t.delete} ${weight.kilograms} ${t.kg}`" @click="emit('remove-weight', weight.id)">
            ×
          </button>
        </template>
      </li>
    </ul>
  </section>
</template>
