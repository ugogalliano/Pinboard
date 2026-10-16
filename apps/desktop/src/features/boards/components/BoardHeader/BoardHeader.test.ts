import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { boardsKeys } from '@/features/boards'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { useToast } from '@ugogalliano/pm-design-system-vue'

import BoardHeader from './BoardHeader.vue'
import { useBoards } from '../../composables/useBoards'
import { useAuthStore } from '@/stores/authStore'
import { membersKeys } from '@/features/members'
import { API_URLS } from '@/shared/constants/urls'
import { server } from '../../../../../test/msw/server'
import { requestLog } from '../../../../../test/msw/requests'
import type { BoardDto, BoardMemberDto, BoardRole } from '@/shared/types/api'

function board(overrides: Partial<BoardDto> = {}): BoardDto {
  return {
    id: 'b1',
    name: 'Product launch',
    createdBy: 'u1',
    createdAt: '2026-02-03T00:00:00Z',
    updatedAt: '2026-02-03T00:00:00Z',
    memberCount: 1,
    ...overrides,
  }
}

function membership(role: BoardRole): BoardMemberDto {
  return {
    userId: 'u1',
    email: 'a@b.co',
    displayName: 'Ada',
    role,
    createdAt: '2026-02-03T00:00:00Z',
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
    server.use(http.get(API_URLS.members.list('b1'), () => HttpResponse.json([membership('Owner')])))

    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/boards/:boardId', component: { template: '<div>canvas</div>' } },
        {
          path: '/boards/:boardId/members',
          name: 'board-members',
          component: { template: '<div>members</div>' },
        },
        { path: '/', component: { template: '<div>home</div>' } },
      ],
    })
    await router.push('/boards/b1')
    await router.isReady()
  })

  afterEach(() => {
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

  it('hides the rename and delete affordances for a non-owner', async () => {
    server.use(
      http.get(API_URLS.boards.list, () => HttpResponse.json([board({ createdBy: 'u2' })])),
      http.get(API_URLS.boards.detail('b1'), () => HttpResponse.json(board({ createdBy: 'u2' }))),
      http.get(API_URLS.members.list('b1'), () => HttpResponse.json([membership('Editor')])),
    )

    const { wrapper } = mountHeader()
    await settle()

    expect(wrapper.find('[data-testid="board-name"]').text()).toBe('Product launch')
    expect(wrapper.find('[data-testid="rename-board"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="delete-board"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="board-members-link"]').attributes('href')).toBe(
      '/boards/b1/members',
    )
  })

  it('uses current membership role rather than createdBy and links all board members to members', async () => {
    server.use(
      http.get(API_URLS.boards.list, () => HttpResponse.json([board({ createdBy: 'u2' })])),
      http.get(API_URLS.boards.detail('b1'), () => HttpResponse.json(board({ createdBy: 'u2' }))),
      http.get(API_URLS.members.list('b1'), () => HttpResponse.json([membership('Owner')])),
    )

    const { wrapper } = mountHeader()
    await settle()

    expect(wrapper.find('[data-testid="rename-board"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="delete-board"]').exists()).toBe(true)
    const membersLink = wrapper.find('[data-testid="board-members-link"]')
    expect(membersLink.exists()).toBe(true)
    expect(membersLink.attributes('href')).toBe('/boards/b1/members')
  })

  it('closes the rename form and refuses PUT after the Owner role changes to Viewer', async () => {
    let memberReads = 0
    let putRequests = 0
    server.use(
      http.get(API_URLS.boards.list, () => HttpResponse.json([board()])),
      http.get(API_URLS.boards.detail('b1'), () => HttpResponse.json(board())),
      http.get(API_URLS.members.list('b1'), () => {
        memberReads += 1
        return HttpResponse.json([membership(memberReads === 1 ? 'Owner' : 'Viewer')])
      }),
      http.put(API_URLS.boards.detail('b1'), () => {
        putRequests += 1
        return HttpResponse.json(board({ name: 'Unexpected rename' }))
      }),
    )
    const { wrapper } = mountHeader()
    await settle()
    await wrapper.find('[data-testid="rename-board"]').trigger('click')
    await flushPromises()
    await typeInto(wrapper, '#rename-board-name', 'Should not save')

    await queryClient.invalidateQueries({ queryKey: membersKeys.list('b1'), exact: true })
    await settle()
    const save = wrapper.find('[data-testid="rename-board-save"]')
    if (save.exists()) await save.trigger('click')
    await settle()

    expect(memberReads).toBe(2)
    expect(wrapper.find('#rename-board-name').exists()).toBe(false)
    expect(wrapper.find('[data-testid="rename-board"]').exists()).toBe(false)
    expect(putRequests).toBe(0)
  })

  it('closes the delete confirmation and refuses DELETE if the Owner role refetch fails', async () => {
    let memberReads = 0
    let deleteRequests = 0
    server.use(
      http.get(API_URLS.boards.list, () => HttpResponse.json([board()])),
      http.get(API_URLS.boards.detail('b1'), () => HttpResponse.json(board())),
      http.get(API_URLS.members.list('b1'), () => {
        memberReads += 1
        return memberReads === 1
          ? HttpResponse.json([membership('Owner')])
          : HttpResponse.json({ status: 500 }, { status: 500 })
      }),
      http.delete(API_URLS.boards.detail('b1'), () => {
        deleteRequests += 1
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { wrapper } = mountHeader()
    await settle()
    await wrapper.find('[data-testid="delete-board"]').trigger('click')
    await flushPromises()
    expect(document.querySelector('[data-testid="confirm-delete-board"]')).not.toBeNull()

    await queryClient.invalidateQueries({ queryKey: membersKeys.list('b1'), exact: true })
    await settle()
    document.querySelector<HTMLButtonElement>('[data-testid="confirm-delete-board"]')?.click()
    await settle()

    expect(memberReads).toBe(2)
    expect(document.querySelector('[data-testid="confirm-delete-board"]')).toBeNull()
    expect(deleteRequests).toBe(0)
  })

  it.each([
    { count: 0, label: '0 members' },
    { count: 1, label: '1 member' },
    { count: 3, label: '3 members' },
  ])('renders the board member count as "$label"', async ({ count, label }) => {
    server.use(
      http.get(API_URLS.boards.list, () => HttpResponse.json([board({ memberCount: count })])),
      http.get(API_URLS.boards.detail('b1'), () =>
        HttpResponse.json(board({ memberCount: count })),
      ),
    )

    const { wrapper } = mountHeader()
    await settle()

    expect(wrapper.text()).toContain(label)
  })

  it('rejects an over-limit name inline (Zod) without issuing the PUT', async () => {
    const stored = [board()]
    let putBody: unknown
    server.use(
      http.get(API_URLS.boards.list, () => HttpResponse.json(stored)),
      http.get(API_URLS.boards.detail('b1'), () => HttpResponse.json(stored[0]!)),
      http.put(API_URLS.boards.detail('b1'), async ({ request }) => {
        putBody = await request.json()
        const updated = { ...stored[0]!, name: 'Renamed board' }
        stored[0] = updated
        return HttpResponse.json(updated)
      }),
    )

    const { wrapper } = mountHeader()
    await settle()

    await wrapper.find('[data-testid="rename-board"]').trigger('click')
    await flushPromises()

    // Over-limit names are rejected inline by the shared Zod schema.
    await typeInto(wrapper, '#rename-board-name', 'x'.repeat(201))
    await wrapper.find('[data-testid="rename-board-save"]').trigger('click')
    await settle()

    expect(putBody).toBeUndefined()
    expect(requestLog.some((entry) => entry.method === 'PUT')).toBe(false)
    expect(wrapper.find('#rename-board-name-error').text()).toContain('at most 200 characters')
  })

  it('renames on a valid name and writes the new name into detail and list caches', async () => {
    const stored = [board()]
    let putBody: unknown
    server.use(
      http.get(API_URLS.boards.list, () => HttpResponse.json(stored)),
      http.get(API_URLS.boards.detail('b1'), () => HttpResponse.json(stored[0]!)),
      http.put(API_URLS.boards.detail('b1'), async ({ request }) => {
        putBody = await request.json()
        const updated = { ...stored[0]!, name: 'Renamed board' }
        stored[0] = updated
        return HttpResponse.json(updated)
      }),
    )

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
    server.use(
      http.get(API_URLS.boards.list, () => HttpResponse.json([board()])),
      http.get(API_URLS.boards.detail('b1'), () => HttpResponse.json(board())),
      http.put(API_URLS.boards.detail('b1'), async ({ request }) => {
        putBody = await request.json()
        return HttpResponse.json({ status: 403, detail: 'owner only' }, { status: 403 })
      }),
    )

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
    server.use(
      http.get(API_URLS.boards.list, () => HttpResponse.json([board()])),
      http.get(API_URLS.boards.detail('b1'), () => HttpResponse.json(board())),
      http.put(API_URLS.boards.detail('b1'), () =>
        HttpResponse.json({ ...board(), name: 'Renamed board' }),
      ),
    )

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
    expect(wrapper.find<HTMLInputElement>('#rename-board-name').element.value).toBe(
      'Product launch',
    )
  })

  it('names the board in the delete confirmation and sends nothing on cancel', async () => {
    server.use(
      http.get(API_URLS.boards.list, () => HttpResponse.json([board()])),
      http.get(API_URLS.boards.detail('b1'), () => HttpResponse.json(board())),
      http.delete(API_URLS.boards.detail('b1'), () => new HttpResponse(null, { status: 204 })),
    )

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

    expect(requestLog.some((entry) => entry.method === 'DELETE')).toBe(false)
    expect(router.currentRoute.value.path).toBe('/boards/b1')
    expect(document.querySelector('[data-testid="confirm-delete-board"]')).toBeNull()
  })

  it('deletes on confirm: navigates home, drops the detail cache and refetches the list', async () => {
    const stored = [board(), board({ id: 'b2', name: 'Second' })]
    let listGets = 0
    server.use(
      http.get(API_URLS.boards.list, () => {
        listGets += 1
        return HttpResponse.json(stored)
      }),
      http.get('/api/boards/:id', ({ params }) =>
        HttpResponse.json(stored.find((item) => item.id === params.id) ?? board()),
      ),
      http.delete('/api/boards/:id', ({ params }) => {
        const index = stored.findIndex((item) => item.id === params.id)
        if (index >= 0) stored.splice(index, 1)
        return new HttpResponse(null, { status: 204 })
      }),
    )

    const { wrapper } = mountHeader()
    await settle()
    expect(queryClient.getQueryData(boardsKeys.detail('b1'))).toBeDefined()
    const listGetsBefore = listGets

    await wrapper.find('[data-testid="delete-board"]').trigger('click')
    await flushPromises()
    await click('[data-testid="confirm-delete-board"]')

    expect(requestLog.filter((entry) => entry.method === 'DELETE')).toHaveLength(1)
    expect(router.currentRoute.value.path).toBe('/')
    expect(queryClient.getQueryData(boardsKeys.detail('b1'))).toBeUndefined()
    expect(listGets).toBe(listGetsBefore + 1)
    expect(useToast().toasts.value.map((t) => t.message)).toContain('Board deleted')
  })

  it('keeps the user on the board and toasts when the delete is rejected', async () => {
    server.use(
      http.get(API_URLS.boards.list, () => HttpResponse.json([board()])),
      http.get(API_URLS.boards.detail('b1'), () => HttpResponse.json(board())),
      http.delete(API_URLS.boards.detail('b1'), () =>
        HttpResponse.json({ status: 403, detail: 'owner only' }, { status: 403 }),
      ),
    )

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
