import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { createPinia, setActivePinia } from 'pinia'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { Toaster, useToast } from '@ugogalliano/pm-design-system-vue'
import { defineComponent, h, onMounted } from 'vue'

import App from '@/app/App/App.vue'
import { API_URLS } from '@/shared/constants/urls'
import { useCreateBoard } from '@/features/boards/composables/useBoards'
import { clearGlobalError, globalError } from '@/shared/composables/useGlobalError'
import { server } from '../../../test/msw/server'

// Phase 8 boundary tests (PLAN.FE.md §13 layer 4): an unhandled render/setup
// error swaps the routed content for the ErrorFallback (toasts still work),
// retry REMOUNTS the content, and a failed MUTATION stays on the toast layer
// — it must never trip the fallback (layer separation regression).

describe('app error boundary', () => {
  let queryClient: QueryClient
  let router: Router
  let wrapper: VueWrapper | null = null
  let consoleError: ReturnType<typeof vi.spyOn>
  let setupCalls = 0
  let throwOnSetup = true

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    useToast().clear()
    clearGlobalError()
    setupCalls = 0
    throwOnSetup = true
    // reportGlobalError logs the raw error once; keep test output clean.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    // Unmount BEFORE the DOM wipe: a live App keeps reacting to the
    // module-scoped globalError ref across tests otherwise.
    wrapper?.unmount()
    wrapper = null
    consoleError.mockRestore()
    document.body.innerHTML = ''
  })

  /** Child whose FIRST setup throws once; later mounts render fine. */
  function makeThrowingChild() {
    return defineComponent({
      setup() {
        setupCalls += 1
        if (throwOnSetup) {
          throwOnSetup = false
          throw new Error('kaboom in child setup')
        }
        return () => h('div', { 'data-testid': 'routed-content' }, 'board view')
      },
    })
  }

  async function mountApp(child: ReturnType<typeof defineComponent>): Promise<VueWrapper> {
    router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: child }],
    })
    await router.push('/')
    await router.isReady()

    wrapper = mount(App, {
      global: { plugins: [createPinia(), router, [VueQueryPlugin, { queryClient }]] },
      attachTo: document.body,
    })
    return wrapper
  }

  it('a child throwing in setup shows the fallback with the Toaster still mounted', async () => {
    const app = await mountApp(makeThrowingChild())
    await flushPromises()

    expect(app.find('[data-testid="error-fallback"]').exists()).toBe(true)
    expect(app.find('[data-testid="routed-content"]').exists()).toBe(false)
    expect(globalError.value!.message).toBe('Something went wrong. Please try again.')
    // The raw error text never reaches the DOM (XSS/leak guard).
    expect(document.body.textContent).not.toContain('kaboom')
    // Toaster is NOT replaced by the fallback — it stays mounted alongside.
    expect(app.findComponent(Toaster).exists()).toBe(true)
  })

  it('exactly one report (and one fallback) per error — no double-report via app.config.errorHandler', async () => {
    await mountApp(makeThrowingChild())
    await flushPromises()

    // onErrorCaptured returns false, so the app-level handler never sees this
    // error: the raw error is console.error'd exactly once, and the DOM holds
    // exactly one fallback.
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(document.querySelectorAll('[data-testid="error-fallback"]')).toHaveLength(1)
  })

  it('retry clears the fallback and REMOUNTS the routed content (fresh setup ran)', async () => {
    const app = await mountApp(makeThrowingChild())
    await flushPromises()
    expect(setupCalls).toBe(1)
    expect(app.find('[data-testid="error-fallback"]').exists()).toBe(true)

    await app.get('[data-testid="error-fallback-retry"]').trigger('click')
    await flushPromises()

    expect(globalError.value).toBeNull()
    expect(app.find('[data-testid="error-fallback"]').exists()).toBe(false)
    expect(app.find('[data-testid="routed-content"]').exists()).toBe(true)
    // The child's setup executed again: clearing the error remounts the
    // routed tree (RouterView is the v-else branch of the boundary toggle).
    expect(setupCalls).toBe(2)
  })

  it('route change clears the fallback: a post-navigation page is never hidden behind a stale boundary', async () => {
    // Security review: a session-terminated redirect (guard → /login) or
    // any navigation must not strand the user on the ErrorFallback of the
    // PREVIOUS page. App watches fullPath (outside its render) and clears
    // the boundary; refs skip same-value sets, so error-free navigations
    // stay zero-churn.
    const Other = defineComponent({
      setup() {
        return () => h('div', { 'data-testid': 'other-content' }, 'safe landing page')
      },
    })
    const throwing = makeThrowingChild()
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: throwing },
        { path: '/login-ish', component: Other },
      ],
    })
    await router.push('/')
    await router.isReady()
    wrapper = mount(App, {
      global: { plugins: [createPinia(), router, [VueQueryPlugin, { queryClient }]] },
      attachTo: document.body,
    })
    await flushPromises()

    // Boundary active on the FIRST page…
    expect(wrapper.find('[data-testid="error-fallback"]').exists()).toBe(true)

    // …navigation drops it and renders the new route's content.
    await router.push('/login-ish')
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 20))
    await flushPromises()

    expect(globalError.value).toBeNull()
    expect(wrapper.find('[data-testid="error-fallback"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="other-content"]').exists()).toBe(true)
  })

  it('a failing MSW-backed mutation toasts and does NOT trip the fallback', async () => {
    server.use(
      http.post(API_URLS.boards.list, () =>
        HttpResponse.json({ status: 500, title: 'Boom' }, { status: 500 }),
      ),
    )

    // Real mutation cycle through the feature composable, caught by the
    // component: the error is HANDLED on the toast layer.
    const FailedCreate = defineComponent({
      setup() {
        const { mutateAsync } = useCreateBoard()
        onMounted(() => {
          // The component owns the rejection; the cycle owns the toast.
          void mutateAsync({ name: 'Nope' }).catch(() => undefined)
        })
        return () => h('div', { 'data-testid': 'routed-content' }, 'board view')
      },
    })

    const app = await mountApp(FailedCreate)
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 50))

    const toasts = useToast().toasts.value
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.variant).toBe('error')
    expect(toasts[0]!.message).toBe('Something went wrong. Please try again.')

    // Layer separation: the toast path never touches the global boundary.
    expect(globalError.value).toBeNull()
    expect(app.find('[data-testid="error-fallback"]').exists()).toBe(false)
    expect(app.find('[data-testid="routed-content"]').exists()).toBe(true)
  })
})
