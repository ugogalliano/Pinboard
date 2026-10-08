import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
  type Router,
  type RouterHistory,
} from 'vue-router'

import PlaceholderPage from '@/app/PlaceholderPage.vue'
import AuthLayout from '@/app/layouts/AuthLayout.vue'
import { LoginForm, RegisterForm } from '@/features/auth'
import { useAuthStore } from '@/stores/authStore'

declare module 'vue-router' {
  interface RouteMeta {
    /** Route requires an authenticated session (redirects to /login). */
    requiresAuth?: boolean
    /** Auth screens: authenticated users are bounced to the app. */
    guestOnly?: boolean
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: PlaceholderPage,
    meta: { requiresAuth: true },
  },
  {
    path: '/login',
    component: AuthLayout,
    meta: { guestOnly: true },
    children: [{ path: '', name: 'login', component: LoginForm }],
  },
  {
    path: '/register',
    component: AuthLayout,
    meta: { guestOnly: true },
    children: [{ path: '', name: 'register', component: RegisterForm }],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

/**
 * Factory so tests can build isolated routers (memory history, per-instance
 * bootstrap flag). main.ts uses the default instance below.
 */
export function createAppRouter(history?: RouterHistory): Router {
  const router = createRouter({
    history: history ?? createWebHistory(import.meta.env.BASE_URL),
    routes,
  })

  // Per-router first-navigation bootstrap, held as a PROMISE (SEC fix):
  // concurrent first navigations all await the SAME run — never a second
  // bootstrap, never a guard that reads auth state mid-flight. The store is
  // resolved INSIDE the guard (pinia is installed before the router in main.ts).
  let boot: Promise<boolean> | null = null

  router.beforeEach(async (to) => {
    const auth = useAuthStore()

    if (!boot) {
      boot = auth.bootstrap()
    }
    await boot

    if (to.meta.requiresAuth && !auth.isAuthenticated) {
      // Only carry ?redirect= when it adds information — landing an
      // unauthenticated guest on "/" should not accumulate ?redirect=%2F.
      return to.fullPath === '/'
        ? { path: '/login' }
        : { path: '/login', query: { redirect: to.fullPath } }
    }

    if (to.meta.guestOnly && auth.isAuthenticated) {
      return { path: '/' }
    }

    return true
  })

  return router
}

const router = createAppRouter()

export default router
