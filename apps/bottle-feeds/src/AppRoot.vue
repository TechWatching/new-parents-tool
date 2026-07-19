<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import UApp from '@nuxt/ui/components/App.vue'
import { en_gb, fr } from '@nuxt/ui/locale'
import App from './App.vue'

const { locale } = useI18n()
const uiLocale = computed(() => (locale.value === 'fr' ? fr : en_gb))
</script>

<template>
  <UApp :locale="uiLocale">
    <App />
  </UApp>
</template>
