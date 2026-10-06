import { createRouter, createWebHistory } from 'vue-router'
import PlaceholderPage from '@/app/PlaceholderPage.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: PlaceholderPage,
    },
  ],
})

export default router
