import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { useToast } from '@ugogalliano/pm-design-system-vue'

import RegisterForm from './RegisterForm.vue'
import { getRefreshToken } from '@/shared/services/token'

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

const TOKENS = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: '2026-01-01T00:00:00Z',
}

describe('RegisterForm', () => {
  let pinia: ReturnType<typeof createPinia>
  let router: Router

  beforeEach(async () => {
    localStorage.clear()
    pinia = createPinia()
    setActivePinia(pinia)
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div>home</div>' } },
        { path: '/login', component: { template: '<div/>' } },
        { path: '/register', component: { template: '<div/>' } },
      ],
    })
    await router.push('/register')
    await router.isReady()
    useToast().clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function mountForm() {
    return mount(RegisterForm, { global: { plugins: [pinia, router] } })
  }

  // Same macrotask-settling rationale as LoginForm.test.ts.
  async function settle() {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  async function fillAndSubmit(wrapper: ReturnType<typeof mountForm>) {
    await wrapper.find('#displayName').setValue('Ada')
    await wrapper.find('#email').setValue('a@b.co')
    await wrapper.find('#password').setValue('hunter2')
    await wrapper.find('form').trigger('submit')
    await settle()
  }

  it('maps a 409 duplicate email to an email field error (no toast, no navigation)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async () =>
        jsonResponse(409, { status: 409, title: 'Conflict', detail: 'email exists' }),
      ),
    )
    const wrapper = mountForm()

    await fillAndSubmit(wrapper)

    const emailError = wrapper.find('#email-error')
    expect(emailError.exists()).toBe(true)
    expect(emailError.text()).toContain('already exists')
    expect(useToast().toasts.value).toHaveLength(0)
    expect(router.currentRoute.value.path).toBe('/register')
  })

  it('registers, auto-logs in and navigates to the app on success', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async (url) => {
        urls.push(String(url))
        if (url === '/api/auth/register') return jsonResponse(201, { id: 'u1' })
        if (url === '/api/auth/login') return jsonResponse(200, TOKENS)
        if (url === '/api/auth/me') {
          return jsonResponse(200, { id: 'u1', email: 'a@b.co', displayName: 'Ada' })
        }
        return jsonResponse(500, { status: 500 })
      }),
    )
    const wrapper = mountForm()

    await fillAndSubmit(wrapper)

    expect(urls).toEqual(['/api/auth/register', '/api/auth/login', '/api/auth/me'])
    expect(getRefreshToken()).toBe('refresh-1')
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('blocks submission with inline validation errors when fields are empty', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(201, {}))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountForm()

    await wrapper.find('form').trigger('submit')
    await settle()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('#email-error').exists()).toBe(true)
    expect(wrapper.find('#password-error').exists()).toBe(true)
    expect(wrapper.find('#displayName-error').exists()).toBe(true)
  })
})
