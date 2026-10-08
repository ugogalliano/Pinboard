import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { useToast } from '@ugogalliano/pm-design-system-vue'

import LoginForm from './LoginForm.vue'
import { getRefreshToken } from '@/shared/services/token'
import type { LoginResponse } from '@/shared/types/api'

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text) as unknown,
  } as unknown as Response
}

const TOKENS: LoginResponse = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: '2026-01-01T00:00:00Z',
}

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

  afterEach(() => {
    vi.unstubAllGlobals()
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
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(200, TOKENS))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountForm()

    await wrapper.find('#email').setValue('not-an-email')
    await wrapper.find('#password').setValue('hunter2')
    await wrapper.find('form').trigger('submit')
    await settle()

    expect(fetchMock).not.toHaveBeenCalled()
    const emailError = wrapper.find('#email-error')
    expect(emailError.exists()).toBe(true)
    expect(emailError.text()).toContain('valid email')
  })

  it('logs in through the store and navigates to the redirect target on success', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async (url) => {
        urls.push(String(url))
        if (url === '/api/auth/login') return jsonResponse(200, TOKENS)
        if (url === '/api/auth/me') {
          return jsonResponse(200, { id: 'u1', email: 'a@b.co', displayName: 'Ada' })
        }
        return jsonResponse(500, { status: 500 })
      }),
    )

    // Land on /login with a redirect target so the round-trip is exercised.
    await router.push({ path: '/login', query: { redirect: '/' } })
    const wrapper = mount(LoginForm, { global: { plugins: [pinia, router] } })

    await wrapper.find('#email').setValue('a@b.co')
    await wrapper.find('#password').setValue('hunter2')
    await wrapper.find('form').trigger('submit')
    await settle()

    expect(urls).toEqual(['/api/auth/login', '/api/auth/me'])
    expect(getRefreshToken()).toBe('refresh-1')
    expect(router.currentRoute.value.path).toBe('/')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('renders the form-level "Invalid email or password" on 401 without a toast', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async () =>
        jsonResponse(401, { status: 401, title: 'Unauthorized', detail: 'invalid credentials' }),
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
  })

  it('surfaces unexpected errors as an error toast', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async (url) => {
        if (url === '/api/auth/login') return jsonResponse(200, TOKENS)
        return jsonResponse(500, { status: 500, title: 'Boom' })
      }),
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
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async (url) => {
        if (url === '/api/auth/login') return jsonResponse(200, TOKENS)
        return jsonResponse(500, { status: 500, title: 'Profile unavailable' })
      }),
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
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async (url) => {
        if (url === '/api/auth/login') return jsonResponse(200, TOKENS)
        if (url === '/api/auth/me') {
          return jsonResponse(200, { id: 'u1', email: 'a@b.co', displayName: 'Ada' })
        }
        return jsonResponse(500, { status: 500 })
      }),
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
