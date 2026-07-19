<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import type { Messages } from '../i18n'
import type { Feed, Weight } from '../types'
import {
  buildReportFilename,
  createDefaultReportConfig,
  createReportSnapshot,
  validateReportConfig,
  type ReportValidationError,
} from '../report/logic'
import { downloadPdf, generateReportPdfBlob } from '../report/pdf'

const props = defineProps<{
  feeds: Feed[]
  weights: Weight[]
  t: Messages
  locale: string
}>()

const isOpen = ref(false)
const isGenerating = ref(false)
const showValidation = ref(false)
const generationError = ref(false)
const triggerRef = ref<HTMLButtonElement | null>(null)
const headingRef = ref<HTMLHeadingElement | null>(null)
const config = reactive(createDefaultReportConfig())

const validationErrors = computed(() => validateReportConfig(config))
const snapshot = computed(() => createReportSnapshot(props.feeds, props.weights, config, new Date()))
const hasSelectedData = computed(() => snapshot.value.feeds.length > 0 || snapshot.value.weights.length > 0)

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
  triggerRef.value?.focus()
})

function closePanel() {
  isOpen.value = false
}

async function handleGenerate() {
  showValidation.value = true
  generationError.value = false
  if (validationErrors.value.length > 0) return

  const generatedAt = new Date()
  const currentSnapshot = createReportSnapshot(props.feeds, props.weights, config, generatedAt)

  try {
    isGenerating.value = true
    const blob = await generateReportPdfBlob(currentSnapshot, props.t, props.locale)
    downloadPdf(blob, buildReportFilename(generatedAt))
  } catch {
    generationError.value = true
  } finally {
    isGenerating.value = false
  }
}
</script>

<template>
  <div class="report-generator">
    <button
      ref="triggerRef"
      type="button"
      class="action-button"
      :aria-expanded="isOpen"
      aria-controls="report-panel"
      @click="isOpen = !isOpen"
    >
      {{ t.generateReport }}
    </button>

    <section
      v-if="isOpen"
      id="report-panel"
      class="card report-panel"
      role="region"
      :aria-labelledby="'report-panel-title'"
      @keydown.esc.prevent="closePanel"
    >
      <div class="report-panel-header">
        <div>
          <h2 id="report-panel-title" ref="headingRef" tabindex="-1">{{ t.reportOptions }}</h2>
          <p>{{ t.reportDescription }}</p>
        </div>
        <button type="button" class="action-button" @click="closePanel">{{ t.cancel }}</button>
      </div>

      <form class="report-form" @submit.prevent="handleGenerate">
        <fieldset class="report-fieldset">
          <legend>{{ t.reportDateRange }}</legend>
          <label class="report-choice">
            <input v-model="config.range" type="radio" name="report-range" value="24h">
            <span>{{ t.today }}</span>
          </label>
          <label class="report-choice">
            <input v-model="config.range" type="radio" name="report-range" value="7d">
            <span>{{ t.sevenDays }}</span>
          </label>
          <label class="report-choice">
            <input v-model="config.range" type="radio" name="report-range" value="all">
            <span>{{ t.reportAllRecordedData }}</span>
          </label>
          <label class="report-choice">
            <input v-model="config.range" type="radio" name="report-range" value="custom">
            <span>{{ t.customRange }}</span>
          </label>
        </fieldset>

        <div v-if="config.range === 'custom'" class="report-custom-range">
          <label>
            <span>{{ t.startDate }}</span>
            <input
              v-model="config.startDate"
              type="date"
              :aria-invalid="showValidation && validationMessages.length > 0 ? 'true' : 'false'"
            >
          </label>
          <label>
            <span>{{ t.endDate }}</span>
            <input
              v-model="config.endDate"
              type="date"
              :aria-invalid="showValidation && validationMessages.length > 0 ? 'true' : 'false'"
            >
          </label>
        </div>

        <fieldset class="report-fieldset">
          <legend>{{ t.reportInclude }}</legend>
          <label class="report-choice">
            <input v-model="config.includeFeeds" type="checkbox">
            <span>{{ t.reportIncludeFeeds }}</span>
          </label>
          <label class="report-choice">
            <input v-model="config.includeWeights" type="checkbox">
            <span>{{ t.reportIncludeWeights }}</span>
          </label>
          <label class="report-choice">
            <input v-model="config.includeComments" type="checkbox">
            <span>{{ t.reportIncludeComments }}</span>
          </label>
        </fieldset>

        <div class="report-preview" aria-live="polite">
          <h3>{{ t.reportPreview }}</h3>
          <p>{{ t.reportPreviewFeeds }}: <strong>{{ snapshot.feedSummary.count }}</strong></p>
          <p>{{ t.reportPreviewWeights }}: <strong>{{ snapshot.weights.length }}</strong></p>
          <p v-if="!hasSelectedData" class="report-preview-empty">{{ t.reportNoDataInRange }}</p>
        </div>

        <div v-if="showValidation && validationMessages.length > 0" class="report-feedback report-feedback--error" role="alert">
          <p v-for="message in validationMessages" :key="message">{{ message }}</p>
        </div>
        <div v-else-if="generationError" class="report-feedback report-feedback--error" role="alert">
          <p>{{ t.reportGenerationError }}</p>
        </div>

        <div class="report-panel-actions">
          <button type="submit" class="primary-button report-generate-button" :disabled="isGenerating">
            {{ isGenerating ? t.reportGenerating : t.reportGeneratePdf }}
          </button>
          <button type="button" class="action-button" @click="closePanel">{{ t.cancel }}</button>
        </div>
      </form>
    </section>
  </div>
</template>
