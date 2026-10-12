import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { useToast } from '@ugogalliano/pm-design-system-vue'

import RegisterForm from './RegisterForm.vue'
import { getRefreshToken } from '@/shared/services/token'
import { API_URLS } from '@/shared/constants/urls'
import { server } from '../../../../../test/msw/server'
import { requestLog } from '../../../../../test/msw/requests'

const TOKENS = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: '2026-01-01T00:00:00Z',
}

const USER = { id: 'u1', email: 'a@b.co', displayName: 'Ada' }

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
    server.use(
      http.post(API_URLS.auth.register, () =>
        HttpResponse.json(
          { status: 409, title: 'Conflict', detail: 'email exists' },
          { status: 409 },
        ),
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
    server.use(
      http.post(API_URLS.auth.register, () => HttpResponse.json({ id: 'u1' }, { status: 201 })),
      http.post(API_URLS.auth.login, () => HttpResponse.json(TOKENS)),
      http.get(API_URLS.auth.me, () => HttpResponse.json(USER)),
    )
    const wrapper = mountForm()

    await fillAndSubmit(wrapper)

    expect(requestLog.map((entry) => entry.url)).toEqual([
      API_URLS.auth.register,
      API_URLS.auth.login,
      API_URLS.auth.me,
    ])
    expect(getRefreshToken()).toBe('refresh-1')
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('blocks submission with inline validation errors when fields are empty', async () => {
    const wrapper = mountForm()

    await wrapper.find('form').trigger('submit')
    await settle()

    expect(requestLog).toHaveLength(0)
    expect(wrapper.find('#email-error').exists()).toBe(true)
    expect(wrapper.find('#password-error').exists()).toBe(true)
    expect(wrapper.find('#displayName-error').exists()).toBe(true)
  })
})
