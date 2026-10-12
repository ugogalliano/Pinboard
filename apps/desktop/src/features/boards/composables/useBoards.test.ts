import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { QueryClient, useQuery, VueQueryPlugin } from '@tanstack/vue-query'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { useToast } from '@ugogalliano/pm-design-system-vue'

import {
  boardsKeys,
  canManageBoard,
  useBoards,
  useCreateBoard,
  useDeleteBoard,
  useUpdateBoard,
} from './useBoards'
import { useAuthStore } from '@/stores/authStore'
import type { BoardDto } from '@/shared/types/api'

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>

// The jsonResponse helper is duplicated per test file on purpose: a shared
// src/test-utils module would ship in the production bundle (convention
// follows LoginForm.test.ts / api.test.ts).
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

function board(id: string, name: string = id): BoardDto {
  return {
    id,
    name,
    createdBy: 'u1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
}

// Mutation chains cross macrotask boundaries, so plain flushPromises() is not
// enough (same reasoning as LoginForm.test.ts).
async function settle(): Promise<void> {
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 50))
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

type Mutations = {
  create: ReturnType<typeof useCreateBoard>
  update: ReturnType<typeof useUpdateBoard>
  remove: ReturnType<typeof useDeleteBoard>
}

/** Mounts the list query plus the three mutations on one Vue instance. */
function mountMutations(pinia: ReturnType<typeof createPinia>, client: QueryClient): Mutations {
  const result: Partial<Mutations> = {}
  const Harness = defineComponent({
    setup() {
      useBoards()
      result.create = useCreateBoard()
      result.update = useUpdateBoard()
      result.remove = useDeleteBoard()
      return () => h('div')
    },
  })

  mount(Harness, { global: { plugins: [pinia, [VueQueryPlugin, { queryClient: client }]] } })
  return result as Mutations
}

/** Mounts a live observer on the future notes key (Phase 5 shape). */
function mountSiblingObserver(
  pinia: ReturnType<typeof createPinia>,
  client: QueryClient,
  queryKey: readonly string[],
  queryFn: () => Promise<Response>,
): void {
  const Harness = defineComponent({
    setup() {
      useQuery({ queryKey, queryFn: async () => await queryFn() })
      return () => h('div')
    },
  })

  mount(Harness, { global: { plugins: [pinia, [VueQueryPlugin, { queryClient: client }]] } })
}

/** Mounts one more live observer of the `['boards']` list (home + sidebar). */
function mountListObserver(pinia: ReturnType<typeof createPinia>, client: QueryClient): void {
  const Harness = defineComponent({
    setup() {
      useBoards()
      return () => h('div')
    },
  })

  mount(Harness, { global: { plugins: [pinia, [VueQueryPlugin, { queryClient: client }]] } })
}

describe('useBoards', () => {
  let pinia: ReturnType<typeof createPinia>
  let queryClient: QueryClient

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    queryClient = makeQueryClient()
    useToast().clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists boards with GET /api/boards and never retries an API error', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(500, { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    mountMutations(pinia, queryClient)
    await settle()

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(['/api/boards'])
    expect(queryClient.getQueryState(boardsKeys.all)?.isInvalidated).toBe(true)
  })

  it('seeds the list cache from the response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async () => jsonResponse(200, [board('b1', 'Alpha'), board('b2', 'Beta')])),
    )

    mountMutations(pinia, queryClient)
    await settle()

    expect(queryClient.getQueryData<BoardDto[]>(boardsKeys.all)).toHaveLength(2)
  })

  it('dedupes concurrent observers of the list into a single GET /api/boards', async () => {
    let getCalls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async () => {
        getCalls += 1
        return jsonResponse(200, [board('b1')])
      }),
    )

    // BoardLayout keeps a live nav observer while the routed page mounts its
    // own — two observers of the same key must not double-fetch.
    mountListObserver(pinia, queryClient)
    mountListObserver(pinia, queryClient)
    await settle()

    expect(getCalls).toBe(1)
    expect(queryClient.getQueryData<BoardDto[]>(boardsKeys.all)).toHaveLength(1)
  })

  it('creates a board with POST /api/boards and refetches the list through an exact invalidation', async () => {
    let getCalls = 0
    let postBody: unknown
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async (_url, init) => {
        const method = init?.method ?? 'GET'
        if (method === 'POST') {
          postBody = JSON.parse(String(init?.body))
          return jsonResponse(200, board('b9', 'New board'))
        }
        getCalls += 1
        return jsonResponse(200, getCalls === 1 ? [board('b1')] : [board('b1'), board('b9')])
      }),
    )

    const { create } = mountMutations(pinia, queryClient)
    await settle()
    expect(getCalls).toBe(1)

    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await create.mutateAsync({ name: 'New board' })
    await settle()

    expect(postBody).toEqual({ name: 'New board' })
    // Invalidation (not an optimistic insert) is what refreshes the list.
    expect(getCalls).toBe(2)
    expect(invalidate).toHaveBeenCalled()
    // Every invalidation this feature issues is prefix-exact.
    const exactFlags = invalidate.mock.calls.map(([filters]) =>
      typeof filters === 'function' ? undefined : filters?.exact,
    )
    expect(exactFlags.length).toBeGreaterThan(0)
    expect(exactFlags.every((exact) => exact === true)).toBe(true)
  })

  it('surfaces a failed create as a toast and leaves the list untouched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async (_url, init) => {
        if ((init?.method ?? 'GET') === 'POST') {
          return jsonResponse(403, { status: 403, detail: 'nope' })
        }
        return jsonResponse(200, [board('b1')])
      }),
    )

    const { create } = mountMutations(pinia, queryClient)
    await settle()

    await expect(create.mutateAsync({ name: 'Nope' })).rejects.toThrow(
      "You don't have permission for this action",
    )
    await settle()

    expect(queryClient.getQueryData<BoardDto[]>(boardsKeys.all)).toHaveLength(1)
    const toasts = useToast().toasts.value
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.variant).toBe('error')
    expect(toasts[0]!.message).toBe("You don't have permission for this action")
  })

  it('writes the updated board into BOTH the detail and the list cache', async () => {
    // A tiny stateful fake so the onSettled refetch reflects the server.
    const stored = [board('b1')]
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async (_url, init) => {
        if ((init?.method ?? 'GET') === 'PUT') {
          const updated = { ...stored[0]!, name: 'Renamed' }
          stored[0] = updated
          return jsonResponse(200, updated)
        }
        return jsonResponse(200, stored)
      }),
    )

    const { update } = mountMutations(pinia, queryClient)
    await settle()
    // Seed the detail cache the way a board page would.
    queryClient.setQueryData(boardsKeys.detail('b1'), board('b1'))

    await update.mutateAsync({ id: 'b1', name: 'Renamed' })
    await settle()

    expect(queryClient.getQueryData<BoardDto>(boardsKeys.detail('b1'))?.name).toBe('Renamed')
    expect(
      queryClient.getQueryData<BoardDto[]>(boardsKeys.all)?.find((item) => item.id === 'b1')?.name,
    ).toBe('Renamed')
  })

  it('removes the board optimistically and rolls back with a toast when the delete fails', async () => {
    let deleteCalls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async (_url, init) => {
        if ((init?.method ?? 'GET') === 'DELETE') {
          deleteCalls += 1
          return jsonResponse(403, { status: 403, detail: 'owner only' })
        }
        return jsonResponse(200, [board('b1'), board('b2')])
      }),
    )

    const { remove } = mountMutations(pinia, queryClient)
    await settle()
    expect(queryClient.getQueryData<BoardDto[]>(boardsKeys.all)).toHaveLength(2)

    await expect(remove.mutateAsync('b2')).rejects.toThrow(
      "You don't have permission for this action",
    )
    await settle()

    expect(deleteCalls).toBe(1)
    // Rollback: the snapshot restored the optimistically removed board.
    expect(queryClient.getQueryData<BoardDto[]>(boardsKeys.all)).toHaveLength(2)
    const toasts = useToast().toasts.value
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.variant).toBe('error')
  })

  it('drops the detail cache entry after a successful delete', async () => {
    const stored = [board('b1'), board('b2')]
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async (url, init) => {
        if ((init?.method ?? 'GET') === 'DELETE') {
          const id = String(url).replace('/api/boards/', '')
          const index = stored.findIndex((item) => item.id === id)
          if (index >= 0) stored.splice(index, 1)
          return emptyResponse()
        }
        return jsonResponse(200, stored)
      }),
    )

    const { remove } = mountMutations(pinia, queryClient)
    await settle()
    queryClient.setQueryData(boardsKeys.detail('b2'), board('b2'))

    await remove.mutateAsync('b2')
    await settle()

    expect(queryClient.getQueryData(boardsKeys.detail('b2'))).toBeUndefined()
    expect(queryClient.getQueryData<BoardDto[]>(boardsKeys.all)?.map((b) => b.id)).toEqual(['b1'])
  })

  it('leaves sibling keys (the future notes/members caches) untouched by list mutations', async () => {
    let notesFetches = 0
    // Both the transport and the sibling observer go through this counter.
    const notesRoute = async (): Promise<Response> => {
      notesFetches += 1
      return jsonResponse(200, [])
    }
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async (url) => {
        if (url.startsWith('/api/boards/b1/notes')) return notesRoute()
        if (url === '/api/boards/b1') return jsonResponse(200, board('b1'))
        if (url === '/api/boards') return jsonResponse(200, [board('b1'), board('b2')])
        return jsonResponse(200, board('b1'))
      }),
    )

    const { create, update, remove } = mountMutations(pinia, queryClient)
    // A live observer on the future notes key (Phase 5 shape) sharing the cache.
    mountSiblingObserver(pinia, queryClient, ['boards', 'b1', 'notes'], notesRoute)
    await settle()

    expect(notesFetches).toBe(1)

    await create.mutateAsync({ name: 'Created' })
    await settle()
    await update.mutateAsync({ id: 'b1', name: 'Renamed' })
    await settle()
    await remove.mutateAsync('b2')
    await settle()

    // exact:true invalidations never reached ['boards', b1, 'notes'].
    expect(notesFetches).toBe(1)
  })

  it('removes the board from the list while the DELETE is still in flight', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async (_url, init) => {
        // A delete that never answers: the cache write must be observable
        // before the server replies, otherwise nothing is "optimistic".
        if ((init?.method ?? 'GET') === 'DELETE') return new Promise<Response>(() => {})
        return jsonResponse(200, [board('b1'), board('b2')])
      }),
    )

    const { remove } = mountMutations(pinia, queryClient)
    await settle()
    expect(queryClient.getQueryData<BoardDto[]>(boardsKeys.all)?.map((b) => b.id)).toEqual([
      'b1',
      'b2',
    ])

    const pending = remove.mutateAsync('b2')
    await settle()

    expect(remove.isPending.value).toBe(true)
    expect(queryClient.getQueryData<BoardDto[]>(boardsKeys.all)?.map((b) => b.id)).toEqual(['b1'])
    void pending
  })

  it('restores the snapshot on failure before the onSettled refetch can mask it', async () => {
    let hangList = false
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async (_url, init) => {
        if ((init?.method ?? 'GET') === 'DELETE') {
          return jsonResponse(403, { status: 403, detail: 'owner only' })
        }
        // From here on the list refetch never resolves, so the ONLY thing
        // that can repopulate ['boards'] is the rollback snapshot.
        if (hangList) return new Promise<Response>(() => {})
        return jsonResponse(200, [board('b1'), board('b2')])
      }),
    )

    const { remove } = mountMutations(pinia, queryClient)
    await settle()
    expect(queryClient.getQueryData<BoardDto[]>(boardsKeys.all)).toHaveLength(2)

    hangList = true
    await expect(remove.mutateAsync('b2')).rejects.toThrow(
      "You don't have permission for this action",
    )
    await settle()

    // Without the rollback the optimistic write would leave only 'b1' behind.
    expect(queryClient.getQueryData<BoardDto[]>(boardsKeys.all)?.map((b) => b.id)).toEqual([
      'b1',
      'b2',
    ])
  })

  it('surfaces a failed rename as a toast and leaves both caches untouched', async () => {
    const stored = [board('b1', 'Alpha')]
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async (_url, init) => {
        if ((init?.method ?? 'GET') === 'PUT') {
          return jsonResponse(403, { status: 403, detail: 'owner only' })
        }
        return jsonResponse(200, stored)
      }),
    )

    const { update } = mountMutations(pinia, queryClient)
    await settle()
    queryClient.setQueryData(boardsKeys.detail('b1'), board('b1', 'Alpha'))

    await expect(update.mutateAsync({ id: 'b1', name: 'Hijack' })).rejects.toThrow(
      "You don't have permission for this action",
    )
    await settle()

    // Rename has no optimistic branch: neither cache may show the new name.
    expect(queryClient.getQueryData<BoardDto>(boardsKeys.detail('b1'))?.name).toBe('Alpha')
    expect(queryClient.getQueryData<BoardDto[]>(boardsKeys.all)?.map((b) => b.name)).toEqual([
      'Alpha',
    ])
    const toasts = useToast().toasts.value
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.variant).toBe('error')
    expect(toasts[0]!.message).toBe("You don't have permission for this action")
  })
})

describe('canManageBoard', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('is true only when the signed-in user created the board (fail-closed)', () => {
    useAuthStore().setUser({ id: 'u1', email: 'a@b.co', displayName: 'Ada' })

    expect(canManageBoard(board('b1'))).toBe(true)
    expect(canManageBoard({ ...board('b1'), createdBy: 'u2' })).toBe(false)

    useAuthStore().setUser(null)
    expect(canManageBoard(board('b1'))).toBe(false)
  })
})
