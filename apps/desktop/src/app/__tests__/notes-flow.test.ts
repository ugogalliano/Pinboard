import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, type Router } from 'vue-router'

import App from '@/app/App/App.vue'
import { createAppRouter } from '@/app/router'
import { useAuthStore } from '@/stores/authStore'
import { clearTokens } from '@/shared/services/token'
import { API_URLS } from '@/shared/constants/urls'
import { server } from '../../../test/msw/server'
import { callsTo } from '../../../test/msw/requests'
import type { BoardDto, LoginResponse, NoteDto } from '@/shared/types/api'

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

function makeNote(id: string, overrides: Partial<NoteDto> = {}): NoteDto {
  return {
    id,
    boardId: 'b1',
    createdBy: 'u1',
    content: 'Buy milk',
    color: 'note-yellow',
    positionX: 40,
    positionY: 60,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

async function settle(): Promise<void> {
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 50))
}

/**
 * A tiny in-memory API covering exactly what the Phase 4 + Phase 5 screens
 * call: boards (shell/header) and notes (canvas), the notes backed by a
 * mutable `stored` array so persistence is asserted against the fake server.
 */
function stubApi(seed: NoteDto[] = []): { stored: NoteDto[]; postBodies: unknown[] } {
  const stored = [...seed]
  const postBodies: unknown[] = []
  const boards = [makeBoard('b1', 'Product launch')]
  let nextNote = stored.length + 1

  server.use(
    http.get(API_URLS.boards.list, () => HttpResponse.json(boards)),
    http.get('/api/boards/:id', ({ params }) => {
      const board = boards.find((item) => item.id === params.id)
      return board
        ? HttpResponse.json(board)
        : HttpResponse.json({ status: 404, detail: 'Board not found' }, { status: 404 })
    }),

    http.get(API_URLS.notes.list(':boardId'), () => HttpResponse.json(stored)),
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
    http.post(API_URLS.notes.list(':boardId'), async ({ request }) => {
      const body = (await request.json()) as Partial<NoteDto>
      postBodies.push(body)
      const created = makeNote(`n${nextNote++}`, {
        content: body.content ?? '',
        color: body.color ?? 'note-yellow',
        positionX: body.positionX ?? 0,
        positionY: body.positionY ?? 0,
      })
      stored.push(created)
      return HttpResponse.json(created)
    }),
    http.put(API_URLS.notes.detail(':noteId'), async ({ request, params }) => {
      const body = (await request.json()) as Partial<NoteDto>
      const index = stored.findIndex((item) => item.id === params.noteId)
      if (index >= 0) stored[index] = { ...stored[index]!, ...body } as NoteDto
      return HttpResponse.json(stored[index]!)
    }),
    http.delete(API_URLS.notes.detail(':noteId'), ({ params }) => {
      const index = stored.findIndex((item) => item.id === params.noteId)
      if (index >= 0) stored.splice(index, 1)
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return { stored, postBodies }
}

describe('notes flow (integration)', () => {
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

  it('renders the canvas with its seeded cards — the placeholder is gone', async () => {
    signIn()
    stubApi([makeNote('n1', { content: 'Buy milk' }), makeNote('n2', { content: 'Ship docs' })])

    const { wrapper, router } = await mountApp()
    await router.push('/boards/b1')
    await settle()

    expect(router.currentRoute.value.name).toBe('board-canvas')
    expect(wrapper.find('[data-testid="note-canvas"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="board-canvas-placeholder"]').exists()).toBe(false)

    const cards = wrapper.findAll('[data-testid="post-it-card"]')
    expect(cards).toHaveLength(2)
    expect(cards[0]!.text()).toContain('Buy milk')
    expect(cards[1]!.text()).toContain('Ship docs')
  })

  it('creates a note from a double-click draft: temp card settles into the real one', async () => {
    signIn()
    const { stored, postBodies } = stubApi([makeNote('n1')])

    const { wrapper, router } = await mountApp()
    await router.push('/boards/b1')
    await settle()

    await wrapper
      .find('[data-testid="note-canvas"]')
      .trigger('dblclick', { clientX: 140, clientY: 90 })
    await flushPromises()
    expect(wrapper.find('[data-testid="note-draft"]').exists()).toBe(true)

    await wrapper.find('[data-testid="note-draft-content"]').setValue('Ship it')
    await wrapper.find('[data-testid="note-draft-content"]').trigger('keydown', { key: 'Enter' })
    await settle()

    // Editor-first create fired ONE POST at the double-click point, the fake
    // server persisted it, and the cache now shows the REAL id only.
    expect(postBodies).toHaveLength(1)
    expect(postBodies[0]).toEqual({
      content: 'Ship it',
      color: 'note-yellow',
      positionX: 140,
      positionY: 90,
    })
    expect(stored.map((item) => item.content)).toEqual(['Buy milk', 'Ship it'])

    const cards = wrapper.findAll('[data-testid="post-it-card"]')
    const ids = cards.map((card) => card.attributes('data-note-id'))
    // The temp id swapped for the real one — no `temp-` residue, draft closed.
    expect(cards).toHaveLength(2)
    expect(cards.map((card) => card.text()).some((text) => text.includes('Ship it'))).toBe(true)
    expect(ids.every((id) => !id?.startsWith('temp-'))).toBe(true)
    expect(wrapper.find('[data-testid="note-draft"]').exists()).toBe(false)
  })

  it('edits a card inline — the PUT persists to the fake server', async () => {
    signIn()
    const { stored } = stubApi([makeNote('n1', { content: 'Buy milk', positionX: 10, positionY: 20 })])

    const { wrapper, router } = await mountApp()
    await router.push('/boards/b1')
    await settle()

    await wrapper.find('[data-testid="post-it-card"]').trigger('dblclick')
    await flushPromises()
    await wrapper.find('[data-testid="note-editor-content"]').setValue('Buy oat milk')
    await wrapper.find('[data-testid="note-editor-content"]').trigger('keydown', { key: 'Enter' })
    await settle()

    expect(stored[0]!.content).toBe('Buy oat milk')
    // Positions preserved through the full-body PUT.
    expect(stored[0]!.positionX).toBe(10)
    expect(wrapper.find('[data-testid="post-it-card"]').text()).toContain('Buy oat milk')
    expect(callsTo(API_URLS.notes.detail('n1'), 'PUT')).toHaveLength(1)
  })

  it('deletes a card — it disappears and the fake server forgets it', async () => {
    signIn()
    const { stored } = stubApi([makeNote('n1')])

    const { wrapper, router } = await mountApp()
    await router.push('/boards/b1')
    await settle()

    await wrapper.find('[data-testid="post-it-card-delete"]').trigger('click')
    await settle()

    expect(wrapper.findAll('[data-testid="post-it-card"]')).toHaveLength(0)
    expect(stored).toHaveLength(0)
    expect(wrapper.find('[data-testid="note-canvas-empty"]').exists()).toBe(true)
  })

  it('keeps guests out of the canvas route (guard unchanged)', async () => {
    stubApi()

    const { router } = await mountApp()
    await settle()

    await router.push('/boards/b1')
    await settle()

    expect(router.currentRoute.value.path).toBe('/login')
    expect(router.currentRoute.value.query.redirect).toBe('/boards/b1')
  })
})
