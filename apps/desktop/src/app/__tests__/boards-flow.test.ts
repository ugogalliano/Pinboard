import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, type Router } from 'vue-router'
import App from '@/app/App/App.vue'
import { createAppRouter } from '@/app/router'
import { boardsKeys } from '@/features/boards'
import { useAuthStore } from '@/stores/authStore'
import { clearTokens } from '@/shared/services/token'
import { API_URLS } from '@/shared/constants/urls'
import { callsTo } from '../../../test/msw/requests'
import { server } from '../../../test/msw/server'
import type { BoardDto, BoardMemberDto, LoginResponse } from '@/shared/types/api'

const TOKENS: LoginResponse = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: '2026-01-01T00:00:00Z',
}

function makeBoard(id: string, name: string): BoardDto {
  return {
    id,
    name,
    createdBy: 'u1',
    createdAt: '2026-02-03T00:00:00Z',
    updatedAt: '2026-02-03T00:00:00Z',
    memberCount: 1,
  }
}

async function settle(): Promise<void> {
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 50))
}

/** A tiny in-memory API covering exactly what the Phase 4 screens call. */
function stubApi(seed: BoardDto[] = []): void {
  const stored = [...seed]

  server.use(
    http.get(API_URLS.boards.list, () => HttpResponse.json(stored)),
    http.post(API_URLS.boards.list, async ({ request }) => {
      const body = (await request.json()) as { name: string }
      const created = makeBoard(`b${stored.length + 1}`, body.name)
      stored.push(created)
      return HttpResponse.json(created)
    }),
    http.put('/api/boards/:id', async ({ request, params }) => {
      const body = (await request.json()) as { name: string }
      const index = stored.findIndex((board) => board.id === params.id)
      if (index >= 0) stored[index] = { ...stored[index]!, name: body.name }
      return HttpResponse.json(stored.find((board) => board.id === params.id)!)
    }),
    http.delete('/api/boards/:id', ({ params }) => {
      const index = stored.findIndex((board) => board.id === params.id)
      if (index >= 0) stored.splice(index, 1)
      return new HttpResponse(null, { status: 204 })
    }),
    http.get('/api/boards/:id', ({ params }) => {
      const board = stored.find((item) => item.id === params.id)
      return board
        ? HttpResponse.json(board)
        : HttpResponse.json({ status: 404, detail: 'Board not found' }, { status: 404 })
    }),
    // Phase 5: the board route renders the real NoteCanvas, so the canvas's
    // notes GET must be answered — an empty list keeps this suite on its
    // Phase 4 assertion surface (boards-flow owns boards, notes-flow owns
    // notes).
    http.get(API_URLS.notes.list(':boardId'), () => HttpResponse.json([])),
    // BoardHeader also reads the current user's membership role.
    http.get(API_URLS.members.list(':boardId'), () =>
      HttpResponse.json([
        {
          userId: 'u1',
          email: 'a@b.co',
          displayName: 'Ada',
          role: 'Owner',
          createdAt: '2026-02-03T00:00:00Z',
        },
      ]),
    ),
  )
}

describe('boards flow (integration)', () => {
  let pinia: ReturnType<typeof createPinia>
  let queryClient: QueryClient

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    localStorage.clear()
    clearTokens()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  function signIn(): void {
    useAuthStore().setTokens(TOKENS)
    // In-memory session only: dropping the persisted refresh token keeps the
    // router guard's bootstrap a no-op (the access token stays in memory).
    localStorage.clear()
    useAuthStore().setUser({ id: 'u1', email: 'a@b.co', displayName: 'Ada' })
  }

  async function mountApp(): Promise<{ wrapper: ReturnType<typeof mount>; router: Router }> {
    const router = createAppRouter(createMemoryHistory())
    const wrapper = mount(App, {
      global: { plugins: [pinia, router, [VueQueryPlugin, { queryClient }]] },
    })
    await router.isReady()
    return { wrapper, router }
  }

  it('shows the board shell and the boards of the signed-in user', async () => {
    signIn()
    stubApi([makeBoard('b1', 'Product launch')])

    const { wrapper } = await mountApp()
    await settle()

    expect(wrapper.find('[data-testid="sidebar"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="app-header"]').exists()).toBe(true)
    // The home grid and the sidebar rail both list the seeded board.
    expect(wrapper.findAll('[data-testid="board-card"]').length).toBeGreaterThan(0)
    expect(wrapper.text()).toContain('Product launch')
  })

  it('creates a board, refetches the list and navigates into its canvas', async () => {
    signIn()
    stubApi([makeBoard('b1', 'Product launch')])

    const { wrapper, router } = await mountApp()
    await settle()

    await wrapper.find('[data-testid="create-board"]').trigger('click')
    await flushPromises()

    // The design-system Dialog teleports its content to document.body.
    const input = document.querySelector<HTMLInputElement>('#create-board-name')!
    input.value = 'Team offsite'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="create-board-submit"]')!.click()
    await settle()

    // The dialog closed and the new board shows up in the refetched list.
    expect(document.querySelector('#create-board-name')).toBeNull()
    const card = wrapper
      .findAll('[data-testid="board-card"]')
      .find((node) => node.text().includes('Team offsite'))
    expect(card).toBeDefined()

    await card!.trigger('click')
    await settle()

    expect(router.currentRoute.value.name).toBe('board-canvas')
    expect(queryClient.getQueryData<BoardDto>(boardsKeys.detail('b2'))?.name).toBe('Team offsite')
    expect(wrapper.find('[data-testid="board-name"]').text()).toBe('Team offsite')
    expect(wrapper.find('[data-testid="note-canvas"]').exists()).toBe(true)
  })

  it('refreshes authoritative member counts after add/remove, not during role updates', async () => {
    signIn()
    stubApi([makeBoard('b1', 'Product launch')])
    const storedMembers: BoardMemberDto[] = [
      {
        userId: 'u1',
        email: 'a@b.co',
        displayName: 'Ada',
        role: 'Owner',
        createdAt: '2026-02-03T00:00:00Z',
      },
    ]
    const authoritativeBoard = () => makeBoard('b1', 'Product launch')
    let releaseAdd!: () => void
    let notifyAddStarted!: () => void
    const addStarted = new Promise<void>((resolve) => {
      notifyAddStarted = resolve
    })
    let releaseRemove!: () => void
    let notifyRemoveStarted!: () => void
    const removeStarted = new Promise<void>((resolve) => {
      notifyRemoveStarted = resolve
    })

    server.use(
      http.get(API_URLS.boards.list, () =>
        HttpResponse.json([{ ...authoritativeBoard(), memberCount: storedMembers.length }]),
      ),
      http.get(API_URLS.boards.detail('b1'), () =>
        HttpResponse.json({ ...authoritativeBoard(), memberCount: storedMembers.length }),
      ),
      http.get(API_URLS.members.list('b1'), () => HttpResponse.json(storedMembers)),
      http.post(API_URLS.members.list('b1'), async ({ request }) => {
        const body = (await request.json()) as { email: string; role: 'Editor' | 'Viewer' }
        await new Promise<void>((resolve) => {
          releaseAdd = resolve
          notifyAddStarted()
        })
        const created: BoardMemberDto = {
          userId: 'u2',
          email: body.email,
          displayName: 'Grace Hopper',
          role: body.role,
          createdAt: '2026-02-04T00:00:00Z',
        }
        storedMembers.push(created)
        return HttpResponse.json(created)
      }),
      http.put(API_URLS.members.detail('b1', 'u2'), async ({ request }) => {
        const body = (await request.json()) as { role: 'Editor' | 'Viewer' }
        const updated = { ...storedMembers[1]!, role: body.role }
        storedMembers[1] = updated
        return HttpResponse.json(updated)
      }),
      http.delete(API_URLS.members.detail('b1', 'u2'), async () => {
        await new Promise<void>((resolve) => {
          releaseRemove = resolve
          notifyRemoveStarted()
        })
        storedMembers.splice(1, 1)
        return new HttpResponse(null, { status: 204 })
      }),
    )

    const { wrapper, router } = await mountApp()
    await settle()
    await router.push('/boards/b1')
    await settle()
    expect(wrapper.find('[data-testid="board-header"]').text()).toContain('1 member')
    expect(queryClient.getQueryData<BoardDto[]>(boardsKeys.all)?.[0]?.memberCount).toBe(1)
    expect(queryClient.getQueryData<BoardDto>(boardsKeys.detail('b1'))?.memberCount).toBe(1)

    await router.push('/boards/b1/members')
    await settle()
    await wrapper.find('[data-testid="add-member"]').trigger('click')
    await flushPromises()
    const email = document.querySelector<HTMLInputElement>('#add-member-email')!
    email.value = 'grace@example.com'
    email.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="add-member-submit"]')!.click()
    await addStarted
    await flushPromises()

    // The client has no memberCount arithmetic: counts stay authoritative until
    // the successful POST updates server state and exact invalidations refetch.
    expect(wrapper.find('[data-testid="board-header"]').text()).toContain('1 member')
    expect(queryClient.getQueryData<BoardDto[]>(boardsKeys.all)?.[0]?.memberCount).toBe(1)
    expect(queryClient.getQueryData<BoardDto>(boardsKeys.detail('b1'))?.memberCount).toBe(1)
    releaseAdd()
    await settle()

    expect(storedMembers).toHaveLength(2)
    expect(wrapper.find('[data-testid="board-header"]').text()).toContain('2 members')
    expect(wrapper.findAll('[data-testid="board-card"]').some((card) => card.text().includes('2 members'))).toBe(true)
    expect(queryClient.getQueryData<BoardDto[]>(boardsKeys.all)?.[0]?.memberCount).toBe(2)
    expect(queryClient.getQueryData<BoardDto>(boardsKeys.detail('b1'))?.memberCount).toBe(2)
    expect(callsTo(API_URLS.boards.list, 'GET').length).toBeGreaterThan(1)
    expect(callsTo(API_URLS.boards.detail('b1'), 'GET').length).toBeGreaterThan(0)

    const listGetsBeforeRoleUpdate = callsTo(API_URLS.boards.list, 'GET').length
    const detailGetsBeforeRoleUpdate = callsTo(API_URLS.boards.detail('b1'), 'GET').length
    await wrapper.find('[data-testid="role-select-u2"]').setValue('Viewer')
    await settle()
    expect(storedMembers[1]?.role).toBe('Viewer')
    expect(callsTo(API_URLS.boards.list, 'GET')).toHaveLength(listGetsBeforeRoleUpdate)
    expect(callsTo(API_URLS.boards.detail('b1'), 'GET')).toHaveLength(detailGetsBeforeRoleUpdate)
    expect(queryClient.getQueryData<BoardDto[]>(boardsKeys.all)?.[0]?.memberCount).toBe(2)
    expect(queryClient.getQueryData<BoardDto>(boardsKeys.detail('b1'))?.memberCount).toBe(2)

    await wrapper.find('[data-testid="remove-member-u2"]').trigger('click')
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="confirm-remove-member"]')!.click()
    await removeStarted
    await flushPromises()
    expect(wrapper.find('[data-testid="board-header"]').text()).toContain('2 members')
    expect(queryClient.getQueryData<BoardDto[]>(boardsKeys.all)?.[0]?.memberCount).toBe(2)
    expect(queryClient.getQueryData<BoardDto>(boardsKeys.detail('b1'))?.memberCount).toBe(2)
    releaseRemove()
    await settle()

    expect(storedMembers).toHaveLength(1)
    expect(wrapper.find('[data-testid="board-header"]').text()).toContain('1 member')
    expect(wrapper.findAll('[data-testid="board-card"]').some((card) => card.text().includes('1 member'))).toBe(true)
    expect(queryClient.getQueryData<BoardDto[]>(boardsKeys.all)?.[0]?.memberCount).toBe(1)
    expect(queryClient.getQueryData<BoardDto>(boardsKeys.detail('b1'))?.memberCount).toBe(1)
    expect(callsTo(API_URLS.boards.list, 'GET').length).toBeGreaterThan(listGetsBeforeRoleUpdate)
    expect(callsTo(API_URLS.boards.detail('b1'), 'GET').length).toBeGreaterThan(detailGetsBeforeRoleUpdate)
  })

  it('bounces guests away from "/" and from a board deep link', async () => {
    stubApi()

    const { router } = await mountApp()
    await settle()

    expect(router.currentRoute.value.path).toBe('/login')

    await router.push('/boards/b1')
    await settle()

    expect(router.currentRoute.value.path).toBe('/login')
    expect(router.currentRoute.value.query.redirect).toBe('/boards/b1')
  })
})
