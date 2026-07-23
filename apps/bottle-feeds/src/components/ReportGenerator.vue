<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue'
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useToast } from '@nuxt/ui/composables/useToast'
import type { Messages } from '../i18n'
import type { Feed, Weight } from '../types'
import {
  buildReportFilename,
  createDefaultReportConfig,
  createReportSnapshot,
  validateReportConfig,
  type ReportValidationError,
} from '../report/logic'
import { generateReportPdfBlob, sharePdf } from '../report/pdf'

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
const triggerRef = ref<InstanceType<typeof UButton> | null>(null)
const headingRef = ref<HTMLHeadingElement | null>(null)
const config = reactive(createDefaultReportConfig())
const toast = useToast()

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
  triggerRef.value?.$el.focus()
})

function closePanel() {
  isOpen.value = false
}

async function handleShare() {
  showValidation.value = true
  generationError.value = false
  if (validationErrors.value.length > 0) return

  const generatedAt = new Date()
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
  <div class="contents">
    <UButton
      ref="triggerRef"
      type="button"
      class="w-full justify-center"
      color="neutral"
      variant="outline"
      :aria-expanded="isOpen"
      aria-controls="report-panel"
      @click="isOpen = !isOpen"
    >
      {{ t.shareReport }}
    </UButton>

    <section
      v-if="isOpen"
      id="report-panel"
      class="col-span-full border border-border-light rounded-[18px] bg-white shadow-[0_5px_22px_rgba(45,72,62,0.05)] p-5"
      role="region"
      :aria-labelledby="'report-panel-title'"
      @keydown.esc.prevent="closePanel"
    >
      <div class="flex justify-between gap-4 items-start max-sm:flex-col max-sm:items-stretch">
        <div>
          <h2 id="report-panel-title" ref="headingRef" class="m-0 text-[19px] font-extrabold" tabindex="-1">{{ t.reportOptions }}</h2>
          <p class="mt-2 text-[#6e7b77] text-[13px]">{{ t.reportDescription }}</p>
        </div>
        <UButton type="button" color="neutral" variant="outline" @click="closePanel">{{ t.cancel }}</UButton>
      </div>

      <form class="grid gap-4 mt-4" @submit.prevent="handleShare">
        <fieldset class="grid gap-2.5 p-0 m-0 border-0">
          <legend class="mb-1 text-[#56635f] text-[13px] font-bold">{{ t.reportDateRange }}</legend>
          <label class="flex flex-row gap-2.5 items-center m-0 text-sm">
            <input v-model="config.range" type="radio" name="report-range" value="24h" class="w-auto">
            <span>{{ t.today }}</span>
          </label>
          <label class="flex flex-row gap-2.5 items-center m-0 text-sm">
            <input v-model="config.range" type="radio" name="report-range" value="7d" class="w-auto">
            <span>{{ t.sevenDays }}</span>
          </label>
          <label class="flex flex-row gap-2.5 items-center m-0 text-sm">
            <input v-model="config.range" type="radio" name="report-range" value="all" class="w-auto">
            <span>{{ t.reportAllRecordedData }}</span>
          </label>
          <label class="flex flex-row gap-2.5 items-center m-0 text-sm">
            <input v-model="config.range" type="radio" name="report-range" value="custom" class="w-auto">
            <span>{{ t.customRange }}</span>
          </label>
        </fieldset>

        <div v-if="config.range === 'custom'" class="report-custom-range grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <label class="flex flex-col gap-1.5 text-[#56635f] text-[13px] font-semibold">
            <span>{{ t.startDate }}</span>
            <input
              v-model="config.startDate"
              type="date"
              class="w-full border border-[#d9e1dd] rounded-[10px] px-3 py-2.5 text-text-primary bg-[#fbfcfb] outline-none"
              :aria-invalid="showValidation && validationMessages.length > 0 ? 'true' : 'false'"
            >
          </label>
          <label class="flex flex-col gap-1.5 text-[#56635f] text-[13px] font-semibold">
            <span>{{ t.endDate }}</span>
            <input
              v-model="config.endDate"
              type="date"
              class="w-full border border-[#d9e1dd] rounded-[10px] px-3 py-2.5 text-text-primary bg-[#fbfcfb] outline-none"
              :aria-invalid="showValidation && validationMessages.length > 0 ? 'true' : 'false'"
            >
          </label>
        </div>

        <fieldset class="report-fieldset grid gap-2.5 p-0 m-0 border-0">
          <legend class="mb-1 text-[#56635f] text-[13px] font-bold">{{ t.reportInclude }}</legend>
          <label class="flex flex-row gap-2.5 items-center m-0 text-sm">
            <input v-model="config.includeFeeds" type="checkbox" class="w-auto">
            <span>{{ t.reportIncludeFeeds }}</span>
          </label>
          <label class="flex flex-row gap-2.5 items-center m-0 text-sm">
            <input v-model="config.includeWeights" type="checkbox" class="w-auto">
            <span>{{ t.reportIncludeWeights }}</span>
          </label>
          <label class="flex flex-row gap-2.5 items-center m-0 text-sm">
            <input v-model="config.includeComments" type="checkbox" class="w-auto">
            <span>{{ t.reportIncludeComments }}</span>
          </label>
        </fieldset>

        <div class="p-3.5 border border-border-light rounded-[14px] bg-surface" aria-live="polite">
          <h3 class="m-0 mb-2.5 text-[#63706c] text-[13px]">{{ t.reportPreview }}</h3>
          <p class="mt-1.5 text-[#56635f] text-[13px]">{{ t.reportPreviewFeeds }}: <strong>{{ snapshot.feedSummary.count }}</strong></p>
          <p class="mt-1.5 text-[#56635f] text-[13px]">{{ t.reportPreviewWeights }}: <strong>{{ snapshot.weights.length }}</strong></p>
          <p v-if="!hasSelectedData" class="mt-1.5 text-[#7f5f1c]">{{ t.reportNoDataInRange }}</p>
        </div>

        <div v-if="showValidation && validationMessages.length > 0" class="p-2.5 rounded-[10px] bg-[#fef2f2] text-[#991b1b]" role="alert">
          <p v-for="message in validationMessages" :key="message" class="m-0 mt-1.5 first:mt-0">{{ message }}</p>
        </div>
        <div v-else-if="generationError" class="p-2.5 rounded-[10px] bg-[#fef2f2] text-[#991b1b]" role="alert">
          <p class="m-0">{{ t.reportGenerationError }}</p>
        </div>

        <div class="flex gap-2.5 items-center flex-wrap max-sm:flex-col max-sm:items-stretch">
          <UButton type="submit" color="error" class="min-w-[180px] justify-center" :loading="isGenerating">
            {{ isGenerating ? t.reportGenerating : t.reportSharePdf }}
          </UButton>
          <UButton type="button" color="neutral" variant="outline" @click="closePanel">{{ t.cancel }}</UButton>
        </div>
      </form>
    </section>
  </div>
</template>
