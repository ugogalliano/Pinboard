import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import Header from './Header.vue'
import { useAuthStore } from '@/stores/authStore'
import { getRefreshToken } from '@/shared/services/token'

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>

function jsonResponse(status: number, body: unknown): Response {
  const text = body === undefined ? '' : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => (text === '' ? undefined : JSON.parse(text)),
  } as unknown as Response
}

async function settle(): Promise<void> {
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 50))
}

describe('Header', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    localStorage.clear()
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div>home</div>' } },
        { path: '/login', component: { template: '<div>login</div>' } },
      ],
    })
    await router.push('/')
    await router.isReady()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the brand and the signed-in user', () => {
    useAuthStore().setUser({ id: 'u1', email: 'a@b.co', displayName: 'Ada' })

    const wrapper = mount(Header, { global: { plugins: [router] } })

    expect(wrapper.find('h1').text()).toBe('PostIt')
    expect(wrapper.find('[data-testid="header-user"]').text()).toBe('Ada')
  })

  it('logs out through the store and lands on /login', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async (url) => {
        urls.push(String(url))
        return jsonResponse(204, undefined)
      }),
    )
    useAuthStore().setTokens({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: '2026-01-01T00:00:00Z',
    })
    useAuthStore().setUser({ id: 'u1', email: 'a@b.co', displayName: 'Ada' })

    const wrapper = mount(Header, { global: { plugins: [router] } })
    await wrapper.find('[data-testid="logout"]').trigger('click')
    await settle()

    expect(urls).toEqual(['/api/auth/logout'])
    expect(getRefreshToken()).toBeNull()
    expect(router.currentRoute.value.path).toBe('/login')
  })
})
