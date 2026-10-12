import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { useToast } from '@ugogalliano/pm-design-system-vue'

import LoginForm from './LoginForm.vue'
import { getRefreshToken } from '@/shared/services/token'
import { API_URLS } from '@/shared/constants/urls'
import { server } from '../../../../../test/msw/server'
import { callsTo, requestLog } from '../../../../../test/msw/requests'
import type { LoginResponse, MeResponse } from '@/shared/types/api'

const TOKENS: LoginResponse = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: '2026-01-01T00:00:00Z',
}

const USER: MeResponse = { id: 'u1', email: 'a@b.co', displayName: 'Ada' }

async function makeStubRouter(): Promise<Router> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div>home</div>' } },
      { path: '/login', component: { template: '<div/>' } },
      { path: '/register', component: { template: '<div/>' } },
    ],
  })
  await router.push('/login')
  await router.isReady()
  return router
}

describe('LoginForm', () => {
  let pinia: ReturnType<typeof createPinia>
  let router: Router

  beforeEach(async () => {
    localStorage.clear()
    pinia = createPinia()
    setActivePinia(pinia)
    router = await makeStubRouter()
    useToast().clear()
  })

  function mountForm() {
    return mount(LoginForm, { global: { plugins: [pinia, router] } })
  }

  // The login chain (handleSubmit → zod → apiClient → store → router.push)
  // crosses a macrotask boundary, so plain flushPromises() is not enough.
  async function settle() {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  it('shows an inline error and does not call the API when the email is invalid', async () => {
    const wrapper = mountForm()

    await wrapper.find('#email').setValue('not-an-email')
    await wrapper.find('#password').setValue('hunter2')
    await wrapper.find('form').trigger('submit')
    await settle()

    expect(requestLog).toHaveLength(0)
    const emailError = wrapper.find('#email-error')
    expect(emailError.exists()).toBe(true)
    expect(emailError.text()).toContain('valid email')
  })

  it('logs in through the store and navigates to the redirect target on success', async () => {
    server.use(
      http.post(API_URLS.auth.login, () => HttpResponse.json(TOKENS)),
      http.get(API_URLS.auth.me, () => HttpResponse.json(USER)),
    )

    // Land on /login with a redirect target so the round-trip is exercised.
    await router.push({ path: '/login', query: { redirect: '/' } })
    const wrapper = mount(LoginForm, { global: { plugins: [pinia, router] } })

    await wrapper.find('#email').setValue('a@b.co')
    await wrapper.find('#password').setValue('hunter2')
    await wrapper.find('form').trigger('submit')
    await settle()

    expect(requestLog.map((entry) => entry.url)).toEqual([API_URLS.auth.login, API_URLS.auth.me])
    expect(getRefreshToken()).toBe('refresh-1')
    expect(router.currentRoute.value.path).toBe('/')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('renders the form-level "Invalid email or password" on 401 without a toast', async () => {
    server.use(
      http.post(API_URLS.auth.login, () =>
        HttpResponse.json(
          { status: 401, title: 'Unauthorized', detail: 'invalid credentials' },
          { status: 401 },
        ),
      ),
    )
    const wrapper = mountForm()

    await wrapper.find('#email').setValue('a@b.co')
    await wrapper.find('#password').setValue('wrong-one')
    await wrapper.find('form').trigger('submit')
    await settle()

    const alert = wrapper.find('[role="alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toBe('Invalid email or password')
    // A failed login is never a toast (PLAN.FE.md §5), and no refresh was run.
    expect(useToast().toasts.value).toHaveLength(0)
    expect(callsTo(API_URLS.auth.refresh)).toHaveLength(0)
  })

  it('surfaces unexpected errors as an error toast', async () => {
    server.use(
      http.post(API_URLS.auth.login, () => HttpResponse.json(TOKENS)),
      http.get(API_URLS.auth.me, () =>
        HttpResponse.json({ status: 500, title: 'Boom' }, { status: 500 }),
      ),
    )
    const wrapper = mountForm()

    await wrapper.find('#email').setValue('a@b.co')
    await wrapper.find('#password').setValue('hunter2')
    await wrapper.find('form').trigger('submit')
    await settle()

    expect(useToast().toasts.value.some((t) => t.variant === 'error')).toBe(true)
    expect(router.currentRoute.value.path).toBe('/login')
  })

  it('shows the mapped toast — NOT "Invalid email or password" — when the profile load fails after login', async () => {
    // Tokens issued fine; GET /me 500s → store throws ProfileLoadError.
    // REVIEW fix 1: forms must not mislabel this as bad credentials.
    server.use(
      http.post(API_URLS.auth.login, () => HttpResponse.json(TOKENS)),
      http.get(API_URLS.auth.me, () =>
        HttpResponse.json({ status: 500, title: 'Profile unavailable' }, { status: 500 }),
      ),
    )
    const wrapper = mountForm()

    await wrapper.find('#email').setValue('a@b.co')
    await wrapper.find('#password').setValue('hunter2')
    await wrapper.find('form').trigger('submit')
    await settle()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    const toasts = useToast().toasts.value
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.message).toBe('Something went wrong. Please try again.')
  })

  it.each([
    ['absolute URL', 'https://evil.example'],
    ['protocol-relative URL', '//evil.example'],
  ])('ignores an unsafe redirect (%s) and lands on the app root', async (_label, evil) => {
    server.use(
      http.post(API_URLS.auth.login, () => HttpResponse.json(TOKENS)),
      http.get(API_URLS.auth.me, () => HttpResponse.json(USER)),
    )

    await router.push({ path: '/login', query: { redirect: evil } })
    const wrapper = mount(LoginForm, { global: { plugins: [pinia, router] } })

    await wrapper.find('#email').setValue('a@b.co')
    await wrapper.find('#password').setValue('hunter2')
    await wrapper.find('form').trigger('submit')
    await settle()

    // SEC fix 3: only same-app paths are honored as post-login targets.
    expect(router.currentRoute.value.path).toBe('/')
  })
})
