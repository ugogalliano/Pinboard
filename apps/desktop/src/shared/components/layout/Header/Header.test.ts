import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import Header from './Header.vue'
import { useAuthStore } from '@/stores/authStore'
import { getRefreshToken } from '@/shared/services/token'
import { API_URLS } from '@/shared/constants/urls'
import { server } from '../../../../../test/msw/server'
import { requestLog } from '../../../../../test/msw/requests'

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

  it('renders the brand and the signed-in user', () => {
    useAuthStore().setUser({ id: 'u1', email: 'a@b.co', displayName: 'Ada' })

    const wrapper = mount(Header, { global: { plugins: [router] } })

    expect(wrapper.find('h1').text()).toBe('PostIt')
    expect(wrapper.find('[data-testid="header-user"]').text()).toBe('Ada')
  })

  it('logs out through the store and lands on /login', async () => {
    server.use(http.post(API_URLS.auth.logout, () => new HttpResponse(null, { status: 204 })))
    useAuthStore().setTokens({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: '2026-01-01T00:00:00Z',
    })
    useAuthStore().setUser({ id: 'u1', email: 'a@b.co', displayName: 'Ada' })

    const wrapper = mount(Header, { global: { plugins: [router] } })
    await wrapper.find('[data-testid="logout"]').trigger('click')
    await settle()

    expect(requestLog.map((entry) => entry.url)).toEqual([API_URLS.auth.logout])
    expect(requestLog[0]!.method).toBe('POST')
    expect(getRefreshToken()).toBeNull()
    expect(router.currentRoute.value.path).toBe('/login')
  })
})
