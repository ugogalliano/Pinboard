import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createMemoryHistory } from 'vue-router'

import App from '@/app/App.vue'
import { createAppRouter } from '@/app/router'
import { useAuthStore } from '@/stores/authStore'
import { clearTokens } from '@/shared/services/token'

describe('app skeleton', () => {
  // Fresh client per test (AGENTS.md §6): a shared one would leak cache and
  // observers between the two mounts below.
  let queryClient: QueryClient

  beforeEach(() => {
    localStorage.clear()
    clearTokens()
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Phase 4: "/" now renders BoardLayout (Sidebar + Header + routed board
  // list) instead of the deleted PlaceholderPage — the shared Header owns the
  // app's <h1>PostIt</h1> brand.
  it('renders the board shell through the router when authenticated', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    // In-memory session (no refresh token) so the guard's bootstrap no-ops
    // and the protected `/` renders instead of redirecting to /login.
    const auth = useAuthStore()
    auth.setTokens({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: '2026-01-01T00:00:00Z',
    })
    localStorage.clear() // keep bootstrap a no-op (memory token remains)
    auth.setUser({ id: 'u1', email: 'a@b.co', displayName: 'Ada' })

    const router = createAppRouter(createMemoryHistory())
    const wrapper = mount(App, {
      global: { plugins: [pinia, router, [VueQueryPlugin, { queryClient }]] },
    })

    await router.isReady()

    expect(router.currentRoute.value.path).toBe('/')
    // BoardLayout chrome (sidebar + header with the brand and the user).
    expect(wrapper.find('h1').text()).toBe('PostIt')
    expect(wrapper.find('[data-testid="sidebar"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Ada')
  })

  it('renders the auth screens for guests (guard redirects to /login)', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const router = createAppRouter(createMemoryHistory())
    const wrapper = mount(App, {
      global: { plugins: [pinia, router, [VueQueryPlugin, { queryClient }]] },
    })

    await router.isReady()

    expect(router.currentRoute.value.path).toBe('/login')
    expect(wrapper.find('h1').text()).toBe('PostIt')
  })
})
