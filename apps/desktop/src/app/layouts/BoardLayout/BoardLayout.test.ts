import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { createPinia, setActivePinia } from 'pinia'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createMemoryHistory, createRouter } from 'vue-router'

import BoardLayout from './BoardLayout.vue'
import { API_URLS } from '@/shared/constants/urls'
import { server } from '../../../../test/msw/server'

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
    // The sidebar's BoardList reads GET /api/boards. A real 200 body (not a
    // 204) keeps vue-query from warning that the query resolved undefined.
    server.use(http.get(API_URLS.boards.list, () => HttpResponse.json([])))
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
