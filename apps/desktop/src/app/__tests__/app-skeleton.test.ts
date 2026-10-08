import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'

import App from '@/app/App.vue'
import { createAppRouter } from '@/app/router'
import { useAuthStore } from '@/stores/authStore'
import { clearTokens } from '@/shared/services/token'

describe('app skeleton', () => {
  beforeEach(() => {
    localStorage.clear()
    clearTokens()
  })

  it('renders the placeholder page through the router when authenticated', async () => {
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
    const wrapper = mount(App, { global: { plugins: [pinia, router] } })

    await router.isReady()

    expect(router.currentRoute.value.path).toBe('/')
    expect(wrapper.find('h1').text()).toBe('PostIt')
  })

  it('renders the auth screens for guests (guard redirects to /login)', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const router = createAppRouter(createMemoryHistory())
    const wrapper = mount(App, { global: { plugins: [pinia, router] } })

    await router.isReady()

    expect(router.currentRoute.value.path).toBe('/login')
    expect(wrapper.find('h1').text()).toBe('PostIt')
  })
})
