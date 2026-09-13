<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue'
import type { CloudRecord } from '../../backends/contracts'
import type { Messages } from '../../i18n'
import { formatDate, formatDateOnly } from '../../utils/format'

interface DisplayConflict {
  id: string
  kind: 'feed' | 'weight'
  local: CloudRecord['record']
  remote: CloudRecord | null
}
defineProps<{ conflicts: DisplayConflict[]; busy: boolean; t: Messages; locale: string }>()
const emit = defineEmits<{ resolve: [id: string, choice: 'local' | 'remote'] }>()
</script>

<template>
  <section v-if="conflicts.length" class="surface mb-5 p-4 sm:p-5" aria-labelledby="conflicts-heading">
    <h2 id="conflicts-heading" class="font-bold text-highlighted">{{ t.sharingConflicts }}</h2>
    <p class="mt-2 max-w-prose text-sm text-toned">{{ t.sharingConflictHelp }}</p>
    <article v-for="conflict in conflicts" :key="conflict.id" class="mt-4 border-t border-default pt-4">
      <h3 class="text-sm font-semibold">{{ conflict.kind === 'feed' ? t.reportIncludeFeeds : t.reportIncludeWeights }}</h3>
      <div class="mt-2 grid gap-4 sm:grid-cols-2">
        <div v-for="side in (['local', 'remote'] as const)" :key="side" class="min-w-0 text-sm">
          <p class="font-semibold">{{ side === 'local' ? t.sharingThisDevice : t.sharingOtherDevice }}</p>
          <template v-for="record in [side === 'local' ? conflict.local : conflict.remote?.record]" :key="side">
            <template v-if="record">
              <p class="mt-1">{{ conflict.kind === 'feed' ? formatDate(record.occurredAt, locale) : formatDateOnly(record.occurredAt, locale) }}</p>
              <p v-if="record.deletedAt" class="mt-1 font-semibold text-red-800">{{ t.sharingDeleted }}</p>
              <template v-else>
                <p class="mt-1">{{ 'amount' in record ? `${record.amount.toLocaleString(locale)} ${t.ml}` : `${record.kilograms.toLocaleString(locale)} ${t.kg}` }}</p>
                <p v-if="'comment' in record && record.comment" class="mt-1 whitespace-pre-wrap break-words text-muted">{{ record.comment }}</p>
              </template>
            </template>
            <p v-else class="mt-1 text-muted">{{ t.sharingMissing }}</p>
          </template>
          <UButton class="mt-3 whitespace-normal" color="neutral" variant="outline" :disabled="busy" @click="emit('resolve', conflict.id, side)">
            {{ side === 'local' ? t.sharingKeepLocal : t.sharingKeepRemote }}
          </UButton>
        </div>
      </div>
    </article>
  </section>
</template>
