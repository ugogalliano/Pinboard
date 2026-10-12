import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createPinia, setActivePinia } from 'pinia'
import { useToast } from '@ugogalliano/pm-design-system-vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import BoardList from './BoardList.vue'

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>

// The jsonResponse helper is duplicated per test file on purpose: a shared
// src/test-utils module would ship in the production bundle.
function jsonResponse(status: number, body: unknown): Response {
  const text = body === undefined ? '' : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => (text === '' ? undefined : JSON.parse(text)),
  } as unknown as Response
}

function board(id: string, name: string) {
  return {
    id,
    name,
    createdBy: 'u1',
    createdAt: '2026-02-03T00:00:00Z',
    updatedAt: '2026-02-03T00:00:00Z',
  }
}

async function settle(): Promise<void> {
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 50))
}

/** A never-resolving fetch keeps the query in its initial pending state. */
function hangingFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn<FetchImpl>(() => new Promise<Response>(() => {})),
  )
}

describe('BoardList', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    setActivePinia(createPinia())
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    useToast().clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  async function mountList(variant?: 'cards' | 'nav') {
    // BoardCard links through the router, so a stub router is always needed.
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/boards/:boardId',
          name: 'board-canvas',
          component: { template: '<div>canvas</div>' },
        },
        { path: '/', component: { template: '<div>home</div>' } },
      ],
    })
    await router.push('/')
    await router.isReady()

    return mount(BoardList, {
      props: variant ? { variant } : {},
      global: { plugins: [router, [VueQueryPlugin, { queryClient }]] },
    })
  }

  it('shows a spinner while the boards are loading', async () => {
    hangingFetch()
    const wrapper = await mountList()

    expect(wrapper.find('[data-testid="board-list-loading"]').exists()).toBe(true)
    expect(wrapper.find('[role="status"]').exists()).toBe(true)
  })

  it('renders an empty state when the user has no boards', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async () => jsonResponse(200, [])),
    )

    const wrapper = await mountList()
    await settle()

    expect(wrapper.find('[data-testid="board-list-empty"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="board-card"]')).toHaveLength(0)
  })

  it('renders a card per board', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async () => jsonResponse(200, [board('b1', 'Alpha'), board('b2', 'Beta')])),
    )

    const wrapper = await mountList()
    await settle()

    const cards = wrapper.findAll('[data-testid="board-card"]')
    expect(cards).toHaveLength(2)
    expect(cards[0]!.text()).toContain('Alpha')
    expect(cards[1]!.text()).toContain('Beta')
  })

  it('shows an error state whose retry issues a second GET', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(500, { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = await mountList()
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await wrapper.find('[data-testid="board-list-retry"]').trigger('click')
    await settle()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('opens the create dialog from the "Create Board" button', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async () => jsonResponse(200, [])),
    )

    const wrapper = await mountList()
    await settle()
    expect(document.querySelector('#create-board-name')).toBeNull()

    await wrapper.find('[data-testid="create-board"]').trigger('click')
    await flushPromises()

    // The design-system Dialog teleports its content to document.body.
    expect(document.querySelector('#create-board-name')).not.toBeNull()
  })

  it('hides the create affordance in the nav variant', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async () => jsonResponse(200, [board('b1', 'Alpha')])),
    )

    const wrapper = await mountList('nav')
    await settle()

    expect(wrapper.find('[data-testid="create-board"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="board-card"]')).toHaveLength(1)
  })
})

