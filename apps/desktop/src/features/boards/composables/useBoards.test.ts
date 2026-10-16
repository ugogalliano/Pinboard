import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
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
import { API_URLS } from '@/shared/constants/urls'
import { server } from '../../../../test/msw/server'
import { requestLog } from '../../../../test/msw/requests'
import type { BoardDto } from '@/shared/types/api'

function board(id: string, name: string = id): BoardDto {
  return {
    id,
    name,
    createdBy: 'u1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    memberCount: 1,
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

  it('lists boards with GET /api/boards and never retries an API error', async () => {
    server.use(
      http.get(API_URLS.boards.list, () => HttpResponse.json({ status: 500 }, { status: 500 })),
    )

    mountMutations(pinia, queryClient)
    await settle()

    expect(requestLog.map((entry) => entry.url)).toEqual([API_URLS.boards.list])
    expect(queryClient.getQueryState(boardsKeys.all)?.isInvalidated).toBe(true)
  })

  it('seeds the list cache from the response', async () => {
    server.use(
      http.get(API_URLS.boards.list, () =>
        HttpResponse.json([board('b1', 'Alpha'), board('b2', 'Beta')]),
      ),
    )

    mountMutations(pinia, queryClient)
    await settle()

    expect(queryClient.getQueryData<BoardDto[]>(boardsKeys.all)).toHaveLength(2)
  })

  it('dedupes concurrent observers of the list into a single GET /api/boards', async () => {
    let getCalls = 0
    server.use(
      http.get(API_URLS.boards.list, () => {
        getCalls += 1
        return HttpResponse.json([board('b1')])
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
    server.use(
      http.get(API_URLS.boards.list, () => {
        getCalls += 1
        return HttpResponse.json(getCalls === 1 ? [board('b1')] : [board('b1'), board('b9')])
      }),
      http.post(API_URLS.boards.list, async ({ request }) => {
        postBody = await request.json()
        return HttpResponse.json(board('b9', 'New board'))
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
    server.use(
      http.get(API_URLS.boards.list, () => HttpResponse.json([board('b1')])),
      http.post(API_URLS.boards.list, () =>
        HttpResponse.json({ status: 403, detail: 'nope' }, { status: 403 }),
      ),
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
    server.use(
      http.get(API_URLS.boards.list, () => HttpResponse.json(stored)),
      http.put(API_URLS.boards.detail('b1'), async ({ request }) => {
        const body = (await request.json()) as { name: string }
        stored[0] = { ...stored[0]!, name: body.name }
        return HttpResponse.json(stored[0]!)
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
    server.use(
      http.get(API_URLS.boards.list, () => HttpResponse.json([board('b1'), board('b2')])),
      http.delete(API_URLS.boards.detail('b2'), () => {
        deleteCalls += 1
        return HttpResponse.json({ status: 403, detail: 'owner only' }, { status: 403 })
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
    server.use(
      http.get(API_URLS.boards.list, () => HttpResponse.json(stored)),
      http.delete('/api/boards/:id', ({ params }) => {
        const index = stored.findIndex((item) => item.id === params.id)
        if (index >= 0) stored.splice(index, 1)
        return new HttpResponse(null, { status: 204 })
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
    // The sibling observer owns its own queryFn; it never goes through fetch.
    const notesRoute = async (): Promise<Response> => {
      notesFetches += 1
      return HttpResponse.json([])
    }
    server.use(
      http.get(API_URLS.boards.list, () => HttpResponse.json([board('b1'), board('b2')])),
      http.get(API_URLS.boards.detail('b1'), () => HttpResponse.json(board('b1'))),
      http.post(API_URLS.boards.list, () => HttpResponse.json(board('b1'))),
      http.put(API_URLS.boards.detail('b1'), () => HttpResponse.json(board('b1'))),
      http.delete(API_URLS.boards.detail('b2'), () => new HttpResponse(null, { status: 204 })),
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
    server.use(
      http.get(API_URLS.boards.list, () => HttpResponse.json([board('b1'), board('b2')])),
      // A delete that never answers: the cache write must be observable
      // before the server replies, otherwise nothing is "optimistic".
      http.delete(API_URLS.boards.detail('b2'), () => new Promise<Response>(() => {})),
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
    server.use(
      http.get(API_URLS.boards.list, () => {
        // From here on the list refetch never resolves, so the ONLY thing
        // that can repopulate ['boards'] is the rollback snapshot.
        if (hangList) return new Promise<Response>(() => {})
        return HttpResponse.json([board('b1'), board('b2')])
      }),
      http.delete(API_URLS.boards.detail('b2'), () =>
        HttpResponse.json({ status: 403, detail: 'owner only' }, { status: 403 }),
      ),
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
    server.use(
      http.get(API_URLS.boards.list, () => HttpResponse.json(stored)),
      http.put(API_URLS.boards.detail('b1'), () =>
        HttpResponse.json({ status: 403, detail: 'owner only' }, { status: 403 }),
      ),
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
