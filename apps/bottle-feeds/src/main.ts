import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import ui from '@nuxt/ui/vue-plugin'
import AppRoot from './AppRoot.vue'
import './style.css'

// Little Sips ships a single light theme with hardcoded light surfaces.
// Nuxt UI's Vue plugin enables system-based dark mode via `useDark()`, which
// adds `class="dark"` to <html> on devices set to dark mode. That flips the
// neutral text tokens light while the app keeps its light backgrounds, making
// most copy unreadable. Pin the color scheme to light (via vueuse's storage
// key) before the plugin initializes so the palette stays consistent.
try {
  localStorage.setItem('vueuse-color-scheme', 'light')
} catch {
  // Ignore environments where localStorage is unavailable.
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
})

createApp(AppRoot).use(router).use(ui).mount('#app')
