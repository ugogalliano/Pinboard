import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createMemoryHistory, createRouter } from 'vue-router'

import BoardLayout from './BoardLayout.vue'

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>

// The sidebar's BoardList reads GET /api/boards. A real 200 body (not a 204)
// keeps vue-query from warning that the query resolved undefined.
function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    json: async () => JSON.stringify(body) as unknown,
  } as unknown as Response
}

async function stubRouter(): Promise<ReturnType<typeof createRouter>> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/',
        component: BoardLayout,
        children: [{ path: '', component: { template: '<div>board-outlet</div>' } }],
      },
    ],
  })
  await router.push('/')
  await router.isReady()
  return router
}

describe('BoardLayout', () => {
  // Fresh client per test (AGENTS.md §6): the two mounts below share the
  // same `['boards']` query, so a reused client would hand the second one a
  // cached payload instead of exercising the fetch path.
  let queryClient: QueryClient

  beforeEach(() => {
    setActivePinia(createPinia())
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async () => jsonResponse([])),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the app chrome (sidebar + header) and the routed outlet', async () => {
    const router = await stubRouter()
    const wrapper = mount(BoardLayout, {
      global: { plugins: [router, [VueQueryPlugin, { queryClient }]] },
    })

    expect(wrapper.find('[data-testid="sidebar"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="app-header"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('board-outlet')
    expect(wrapper.find('h1').text()).toBe('PostIt')
  })

  it('keeps the sidebar toggle wired to the ui store', async () => {
    const router = await stubRouter()
    const wrapper = mount(BoardLayout, {
      global: { plugins: [router, [VueQueryPlugin, { queryClient }]] },
    })

    await wrapper.find('[data-testid="sidebar-toggle"]').trigger('click')

    expect(wrapper.find('[data-testid="sidebar-toggle"]').attributes('aria-expanded')).toBe('false')
  })
})
