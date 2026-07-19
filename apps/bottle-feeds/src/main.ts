import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import Root from './Root.vue'
import './style.css'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
})

createApp(Root).use(router).mount('#app')
