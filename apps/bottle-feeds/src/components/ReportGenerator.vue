<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue'
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useToast } from '@nuxt/ui/composables/useToast'
import type { Messages } from '../i18n'
import type { Feed, Weight } from '../types'
import {
  buildReportFilename,
  conflictsAffectReport,
  createDefaultReportConfig,
  createReportSnapshot,
  validateReportConfig,
  type ReportValidationError,
  type ReportConflict,
} from '../report/logic'
import { generateReportPdfBlob, sharePdf } from '../report/pdf'

const props = withDefaults(defineProps<{
  feeds: Feed[]
  weights: Weight[]
  t: Messages
  locale: string
  now?: number
  conflicts?: ReportConflict[]
}>(), { now: () => Date.now(), conflicts: () => [] })

const isOpen = ref(false)
const isGenerating = ref(false)
const showValidation = ref(false)
const generationError = ref(false)
const triggerRef = ref<InstanceType<typeof UButton> | null>(null)
const headingRef = ref<HTMLHeadingElement | null>(null)
const config = reactive(createDefaultReportConfig(new Date(props.now)))
const toast = useToast()

const validationErrors = computed(() => validateReportConfig(config))
const snapshot = computed(() => createReportSnapshot(props.feeds, props.weights, config, new Date(props.now)))
const hasSelectedData = computed(() => snapshot.value.feeds.length > 0 || snapshot.value.weights.length > 0)
const hasConflicts = computed(() => conflictsAffectReport(props.conflicts, config, new Date(props.now)))

const validationMessages = computed(() => {
  const lookup: Record<ReportValidationError, string> = {
    categories: props.t.reportValidationCategories,
    startDate: props.t.reportValidationStartDate,
    endDate: props.t.reportValidationEndDate,
    dateOrder: props.t.reportValidationDateOrder,
  }
  return validationErrors.value.map((error) => lookup[error])
})

watch(isOpen, async (open) => {
  if (open) {
    generationError.value = false
    await nextTick()
    headingRef.value?.focus()
    return
  }
  await nextTick()
  triggerRef.value?.$el.focus()
})

function closePanel() {
  isOpen.value = false
}

async function handleShare() {
  showValidation.value = true
  generationError.value = false
  if (validationErrors.value.length > 0 || hasConflicts.value) return

  const generatedAt = new Date()
  if (conflictsAffectReport(props.conflicts, config, generatedAt)) {
    generationError.value = true
    return
  }
  const currentSnapshot = createReportSnapshot(props.feeds, props.weights, config, generatedAt)

  try {
    isGenerating.value = true
    const blob = await generateReportPdfBlob(currentSnapshot, props.t, props.locale)
    const result = await sharePdf(blob, buildReportFilename(generatedAt))
    if (result === 'cancelled') return
    toast.add({
      title: props.t.shareReport,
      description: result === 'shared' ? props.t.reportShareSuccess : props.t.reportDownloadSuccess,
      color: 'success',
    })
  } catch {
    generationError.value = true
  } finally {
    isGenerating.value = false
  }
}
</script>

<template>
  <div class="report-generator contents">
    <UButton
      ref="triggerRef"
      type="button"
      color="neutral"
      variant="outline"
      class="min-w-0 flex-1 basis-0 justify-center whitespace-normal text-center"
      :aria-expanded="isOpen"
      aria-controls="report-panel"
      @click="isOpen = !isOpen"
    >
      {{ t.shareReport }}
    </UButton>

    <section
      v-if="isOpen"
      id="report-panel"
      class="surface mt-2 w-full basis-full p-5 sm:p-6"
      role="region"
      :aria-labelledby="'report-panel-title'"
      @keydown.esc.prevent="closePanel"
    >
      <div class="flex items-start justify-between gap-4 max-[500px]:flex-col max-[500px]:items-stretch">
        <div>
          <h2 id="report-panel-title" ref="headingRef" tabindex="-1" class="text-lg font-extrabold text-highlighted outline-none">{{ t.reportOptions }}</h2>
          <p class="mt-2 text-[13px] text-muted">{{ t.reportDescription }}</p>
        </div>
        <UButton type="button" color="neutral" variant="ghost" size="sm" @click="closePanel">{{ t.cancel }}</UButton>
      </div>

      <form class="mt-4 grid gap-4" @submit.prevent="handleShare">
        <fieldset class="report-fieldset m-0 grid gap-2.5 border-0 p-0">
          <legend class="mb-1 text-[13px] font-bold text-toned">{{ t.reportDateRange }}</legend>
          <label class="flex flex-row items-center gap-2.5 text-sm text-toned">
            <input v-model="config.range" class="size-4 accent-coral-500" type="radio" name="report-range" value="24h">
            <span>{{ t.today }}</span>
          </label>
          <label class="flex flex-row items-center gap-2.5 text-sm text-toned">
            <input v-model="config.range" class="size-4 accent-coral-500" type="radio" name="report-range" value="7d">
            <span>{{ t.sevenDays }}</span>
          </label>
          <label class="flex flex-row items-center gap-2.5 text-sm text-toned">
            <input v-model="config.range" class="size-4 accent-coral-500" type="radio" name="report-range" value="all">
            <span>{{ t.reportAllRecordedData }}</span>
          </label>
          <label class="flex flex-row items-center gap-2.5 text-sm text-toned">
            <input v-model="config.range" class="size-4 accent-coral-500" type="radio" name="report-range" value="custom">
            <span>{{ t.customRange }}</span>
          </label>
        </fieldset>

        <div v-if="config.range === 'custom'" class="report-custom-range grid grid-cols-2 gap-3 max-[500px]:grid-cols-1">
          <label class="flex flex-col gap-2 text-sm font-semibold text-toned">
            <span>{{ t.startDate }}</span>
            <input
              v-model="config.startDate"
              class="field"
              type="date"
              :aria-invalid="showValidation && validationMessages.length > 0 ? 'true' : 'false'"
            >
          </label>
          <label class="flex flex-col gap-2 text-sm font-semibold text-toned">
            <span>{{ t.endDate }}</span>
            <input
              v-model="config.endDate"
              class="field"
              type="date"
              :aria-invalid="showValidation && validationMessages.length > 0 ? 'true' : 'false'"
            >
          </label>
        </div>

        <fieldset class="report-fieldset m-0 grid gap-2.5 border-0 p-0">
          <legend class="mb-1 text-[13px] font-bold text-toned">{{ t.reportInclude }}</legend>
          <label class="flex flex-row items-center gap-2.5 text-sm text-toned">
            <input v-model="config.includeFeeds" class="size-4 accent-coral-500" type="checkbox">
            <span>{{ t.reportIncludeFeeds }}</span>
          </label>
          <label class="flex flex-row items-center gap-2.5 text-sm text-toned">
            <input v-model="config.includeWeights" class="size-4 accent-coral-500" type="checkbox">
            <span>{{ t.reportIncludeWeights }}</span>
          </label>
          <label class="flex flex-row items-center gap-2.5 text-sm text-toned">
            <input v-model="config.includeComments" class="size-4 accent-coral-500" type="checkbox">
            <span>{{ t.reportIncludeComments }}</span>
          </label>
        </fieldset>

        <div class="rounded-2xl border border-default bg-sage-50/60 p-4" aria-live="polite">
          <h3 class="mb-2.5 text-[13px] text-muted">{{ t.reportPreview }}</h3>
          <p class="mt-1.5 text-sm text-toned">{{ t.reportPreviewFeeds }}: <strong class="text-highlighted">{{ snapshot.feedSummary.count }}</strong></p>
          <p class="mt-1.5 text-sm text-toned">{{ t.reportPreviewWeights }}: <strong class="text-highlighted">{{ snapshot.weights.length }}</strong></p>
          <p v-if="!hasSelectedData" class="mt-1.5 text-sm text-amber-700">{{ t.reportNoDataInRange }}</p>
        </div>

        <div v-if="showValidation && validationMessages.length > 0" class="rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">
          <p v-for="message in validationMessages" :key="message">{{ message }}</p>
        </div>
        <div v-else-if="generationError" class="rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">
          <p>{{ t.reportGenerationError }}</p>
        </div>
        <p v-if="hasConflicts" class="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="alert">{{ t.sharingReportBlocked }}</p>

        <div class="flex flex-wrap items-center gap-2.5 max-[500px]:flex-col max-[500px]:items-stretch">
          <UButton type="submit" class="min-w-[180px] justify-center font-semibold" size="lg" :disabled="isGenerating || hasConflicts" :loading="isGenerating">
            {{ isGenerating ? t.reportGenerating : t.reportSharePdf }}
          </UButton>
          <UButton type="button" color="neutral" variant="outline" @click="closePanel">{{ t.cancel }}</UButton>
        </div>
      </form>
    </section>
  </div>
</template>
