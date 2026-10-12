import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { boardsKeys } from '@/features/boards'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { useToast } from '@ugogalliano/pm-design-system-vue'

import BoardHeader from './BoardHeader.vue'
import { useBoards } from '../composables/useBoards'
import { useAuthStore } from '@/stores/authStore'
import type { BoardDto } from '@/shared/types/api'

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

function emptyResponse(): Response {
  return { ok: true, status: 204, text: async () => '' } as unknown as Response
}

function board(overrides: Partial<BoardDto> = {}): BoardDto {
  return {
    id: 'b1',
    name: 'Product launch',
    createdBy: 'u1',
    createdAt: '2026-02-03T00:00:00Z',
    updatedAt: '2026-02-03T00:00:00Z',
    ...overrides,
  }
}

async function settle(): Promise<void> {
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 50))
}

/** Types into a DS Input rendered inside the component (not teleported). */
async function typeInto(wrapper: VueWrapper, selector: string, value: string): Promise<void> {
  await wrapper.find(selector).setValue(value)
  await flushPromises()
}

async function click(selector: string): Promise<void> {
  document.querySelector<HTMLButtonElement>(selector)!.click()
  await settle()
}

describe('BoardHeader', () => {
  let pinia: ReturnType<typeof createPinia>
  let queryClient: QueryClient
  let router: Router

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    useToast().clear()

    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/boards/:boardId', component: { template: '<div>canvas</div>' } },
        { path: '/', component: { template: '<div>home</div>' } },
      ],
    })
    await router.push('/boards/b1')
    await router.isReady()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  function mountHeader() {
    // In-memory session (the store owns tokens, not the component).
    useAuthStore().setTokens({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: '2026-01-01T00:00:00Z',
    })
    useAuthStore().setUser({ id: 'u1', email: 'a@b.co', displayName: 'Ada' })

    const Host = defineComponent({
      setup() {
        // A live list observer, as the sidebar always provides.
        useBoards()
        return () => h(BoardHeader)
      },
    })

    const wrapper = mount(Host, {
      global: { plugins: [router, [VueQueryPlugin, { queryClient }]] },
      // Attached so jsdom performs real form submission on the Save button.
      attachTo: document.body,
    })
    return { wrapper }
  }

  function stubBoards(handler: FetchImpl): void {
    vi.stubGlobal('fetch', handler)
  }

  it('hides the rename and delete affordances for a non-owner', async () => {
    stubBoards(async () => jsonResponse(200, board({ createdBy: 'u2' })))

    const { wrapper } = mountHeader()
    await settle()

    expect(wrapper.find('[data-testid="board-name"]').text()).toBe('Product launch')
    expect(wrapper.find('[data-testid="rename-board"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="delete-board"]').exists()).toBe(false)
  })

  it('rejects an over-limit name inline (Zod) without issuing the PUT', async () => {
    const stored = [board()]
    let putBody: unknown
    stubBoards(async (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'PUT') {
        putBody = JSON.parse(String(init?.body))
        const updated = { ...stored[0]!, name: String(putBody) === '' ? '' : 'Renamed board' }
        stored[0] = updated
        return jsonResponse(200, updated)
      }
      if (url === '/api/boards/b1') return jsonResponse(200, stored[0]!)
      return jsonResponse(200, stored)
    })

    const { wrapper } = mountHeader()
    await settle()

    await wrapper.find('[data-testid="rename-board"]').trigger('click')
    await flushPromises()

    // Over-limit names are rejected inline by the shared Zod schema.
    await typeInto(wrapper, '#rename-board-name', 'x'.repeat(201))
    await wrapper.find('[data-testid="rename-board-save"]').trigger('click')
    await settle()

    expect(putBody).toBeUndefined()
    expect(wrapper.find('#rename-board-name-error').text()).toContain('at most 200 characters')
  })

  it('renames on a valid name and writes the new name into detail and list caches', async () => {
    const stored = [board()]
    let putBody: unknown
    stubBoards(async (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'PUT') {
        putBody = JSON.parse(String(init?.body))
        const updated = { ...stored[0]!, name: 'Renamed board' }
        stored[0] = updated
        return jsonResponse(200, updated)
      }
      if (url === '/api/boards/b1') return jsonResponse(200, stored[0]!)
      return jsonResponse(200, stored)
    })

    const { wrapper } = mountHeader()
    await settle()
    await wrapper.find('[data-testid="rename-board"]').trigger('click')
    await flushPromises()

    await typeInto(wrapper, '#rename-board-name', 'Renamed board')
    await wrapper.find('[data-testid="rename-board-save"]').trigger('click')
    await settle()

    expect(putBody).toEqual({ name: 'Renamed board' })
    expect(queryClient.getQueryData<BoardDto>(boardsKeys.detail('b1'))?.name).toBe('Renamed board')
    expect(
      queryClient.getQueryData<BoardDto[]>(boardsKeys.all)?.find((item) => item.id === 'b1')?.name,
    ).toBe('Renamed board')
    expect(wrapper.find('[data-testid="board-name"]').text()).toBe('Renamed board')
  })

  it('keeps the name and toasts exactly once when the rename is rejected (403)', async () => {
    let putBody: unknown
    // handleSubmit re-throws submit-callback errors: without the component's
    // own try/catch the failed PUT escapes as an unhandledrejection.
    const unhandled: unknown[] = []
    const onUnhandled = (event: PromiseRejectionEvent): void => {
      unhandled.push(event.reason)
    }
    window.addEventListener('unhandledrejection', onUnhandled)
    stubBoards(async (url, init) => {
      if ((init?.method ?? 'GET') === 'PUT') {
        putBody = JSON.parse(String(init?.body))
        return jsonResponse(403, { status: 403, detail: 'owner only' })
      }
      if (url === '/api/boards/b1') return jsonResponse(200, board())
      return jsonResponse(200, [board()])
    })

    const { wrapper } = mountHeader()
    await settle()

    await wrapper.find('[data-testid="rename-board"]').trigger('click')
    await flushPromises()
    await typeInto(wrapper, '#rename-board-name', 'Hijack')
    await wrapper.find('[data-testid="rename-board-save"]').trigger('click')
    await settle()

    // The PUT reached the server and was refused: the SAVED name survives, in
    // the cache and on screen (the rename form stays open).
    expect(putBody).toEqual({ name: 'Hijack' })
    expect(queryClient.getQueryData<BoardDto>(boardsKeys.detail('b1'))?.name).toBe('Product launch')
    expect(unhandled).toEqual([])
    // Exactly one toast, from useUpdateBoard.onError — the component must not
    // toast a second time for the same failure.
    const toasts = useToast().toasts.value
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.variant).toBe('error')
    expect(toasts[0]!.message).toBe("You don't have permission for this action")
    // A 403 is not a form-level 400, so there is no inline error — and the
    // submitting state must be reset (button clickable again).
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    const save = wrapper.find('[data-testid="rename-board-save"]')
    expect(save.attributes('disabled')).toBeUndefined()
    expect(save.attributes('aria-busy')).toBeUndefined()

    window.removeEventListener('unhandledrejection', onUnhandled)
  })

  it('re-seeds the rename field with the saved name when a cancelled attempt is reopened', async () => {
    stubBoards(async (url, init) => {
      if ((init?.method ?? 'GET') === 'PUT') {
        return jsonResponse(200, { ...board(), name: 'Renamed board' })
      }
      if (url === '/api/boards/b1') return jsonResponse(200, board())
      return jsonResponse(200, [board()])
    })

    const { wrapper } = mountHeader()
    await settle()

    // Open, type something, then abandon the attempt with Cancel.
    await wrapper.find('[data-testid="rename-board"]').trigger('click')
    await flushPromises()
    await typeInto(wrapper, '#rename-board-name', 'Abandoned text')
    await wrapper.find('[data-testid="rename-board-cancel"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('#rename-board-name').exists()).toBe(false)

    // Reopening must show the board's SAVED name, never the abandoned text.
    await wrapper.find('[data-testid="rename-board"]').trigger('click')
    await flushPromises()
    expect(wrapper.find<HTMLInputElement>('#rename-board-name').element.value).toBe('Product launch')
  })

  it('names the board in the delete confirmation and sends nothing on cancel', async () => {
    let deleteCalls = 0
    stubBoards(async (url, init) => {
      if ((init?.method ?? 'GET') === 'DELETE') {
        deleteCalls += 1
        return emptyResponse()
      }
      if (url === '/api/boards/b1') return jsonResponse(200, board())
      return jsonResponse(200, [board()])
    })

    const { wrapper } = mountHeader()
    await settle()

    await wrapper.find('[data-testid="delete-board"]').trigger('click')
    await flushPromises()

    // User content (board name) is rendered as text inside the confirmation.
    const dialogText = document.body.textContent ?? ''
    expect(dialogText).toContain('Product launch')
    expect(dialogText.toLowerCase()).toContain('cannot be undone')

    // Cancelling leaves without issuing a request.
    await click('[data-testid="cancel-delete-board"]')

    expect(deleteCalls).toBe(0)
    expect(router.currentRoute.value.path).toBe('/boards/b1')
    expect(document.querySelector('[data-testid="confirm-delete-board"]')).toBeNull()
  })

  it('deletes on confirm: navigates home, drops the detail cache and refetches the list', async () => {
    const stored = [board(), board({ id: 'b2', name: 'Second' })]
    let deleteCalls = 0
    let listGets = 0
    stubBoards(async (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'DELETE') {
        deleteCalls += 1
        const id = String(url).replace('/api/boards/', '')
        const index = stored.findIndex((item) => item.id === id)
        if (index >= 0) stored.splice(index, 1)
        return emptyResponse()
      }
      if (url === '/api/boards') {
        listGets += 1
        return jsonResponse(200, stored)
      }
      const id = String(url).replace('/api/boards/', '')
      return jsonResponse(200, stored.find((item) => item.id === id) ?? board())
    })

    const { wrapper } = mountHeader()
    await settle()
    expect(queryClient.getQueryData(boardsKeys.detail('b1'))).toBeDefined()
    const listGetsBefore = listGets

    await wrapper.find('[data-testid="delete-board"]').trigger('click')
    await flushPromises()
    await click('[data-testid="confirm-delete-board"]')

    expect(deleteCalls).toBe(1)
    expect(router.currentRoute.value.path).toBe('/')
    expect(queryClient.getQueryData(boardsKeys.detail('b1'))).toBeUndefined()
    expect(listGets).toBe(listGetsBefore + 1)
    expect(useToast().toasts.value.map((t) => t.message)).toContain('Board deleted')
  })

  it('keeps the user on the board and toasts when the delete is rejected', async () => {
    stubBoards(async (url, init) => {
      if ((init?.method ?? 'GET') === 'DELETE') {
        return jsonResponse(403, { status: 403, detail: 'owner only' })
      }
      if (url === '/api/boards/b1') return jsonResponse(200, board())
      return jsonResponse(200, [board()])
    })

    const { wrapper } = mountHeader()
    await settle()

    await wrapper.find('[data-testid="delete-board"]').trigger('click')
    await flushPromises()
    await click('[data-testid="confirm-delete-board"]')

    expect(router.currentRoute.value.path).toBe('/boards/b1')
    // Rollback lives in the composable; the board is still on screen.
    expect(queryClient.getQueryData<BoardDto[]>(boardsKeys.all)).toHaveLength(1)
    const toasts = useToast().toasts.value
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.variant).toBe('error')
    expect(toasts[0]!.message).toBe("You don't have permission for this action")
  })
})
