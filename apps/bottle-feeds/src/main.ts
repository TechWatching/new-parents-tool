import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import AppRoot from './AppRoot.vue'
import './style.css'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
})

createApp(AppRoot).use(router).mount('#app')
