import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { QueryClient, useQuery, VueQueryPlugin } from '@tanstack/vue-query'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, ref } from 'vue'
import { useToast } from '@ugogalliano/pm-design-system-vue'

import {
  notesKeys,
  useCreateNote,
  useDeleteNote,
  useNotesQuery,
  useUpdateNote,
} from './useNotes'
import { useAuthStore } from '@/stores/authStore'
import { API_URLS } from '@/shared/constants/urls'
import { clearTokens } from '@/shared/services/token'
import { server } from '../../../../test/msw/server'
import { callsTo, requestLog } from '../../../../test/msw/requests'
import type { LoginResponse, NoteDto, UpdateNoteRequest } from '@/shared/types/api'

const BOARD = 'b1'
const LIST_URL = API_URLS.notes.list(BOARD)

const TOKENS: LoginResponse = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: '2026-01-01T00:00:00Z',
}

/** Field-for-field NoteDto fixture (mirrors the backend record exactly). */
function note(id: string, overrides: Partial<NoteDto> = {}): NoteDto {
  return {
    id,
    boardId: BOARD,
    createdBy: 'u1',
    content: 'Hello',
    color: 'note-yellow',
    positionX: 0,
    positionY: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// Mutation chains cross macrotask boundaries, so plain flushPromises() is not
// enough (same reasoning as useBoards.test.ts).
async function settle(): Promise<void> {
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 50))
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function cachedNotes(client: QueryClient): NoteDto[] {
  return client.getQueryData<NoteDto[]>(notesKeys.list(BOARD)) ?? []
}

type Mutations = {
  create: ReturnType<typeof useCreateNote>
  update: ReturnType<typeof useUpdateNote>
  remove: ReturnType<typeof useDeleteNote>
}

/** Mounts the three notes mutations on one Vue instance (board `b1`). */
function mountMutations(pinia: ReturnType<typeof createPinia>, client: QueryClient): Mutations {
  const result: Partial<Mutations> = {}
  const Harness = defineComponent({
    setup() {
      result.create = useCreateNote(BOARD)
      result.update = useUpdateNote(BOARD)
      result.remove = useDeleteNote(BOARD)
      return () => h('div')
    },
  })

  mount(Harness, { global: { plugins: [pinia, [VueQueryPlugin, { queryClient: client }]] } })
  return result as Mutations
}

/** Mounts the notes list query plus the three mutations (board `b1`). */
function mountQueryAndMutations(
  pinia: ReturnType<typeof createPinia>,
  client: QueryClient,
): Mutations {
  const result: Partial<Mutations> = {}
  const Harness = defineComponent({
    setup() {
      useNotesQuery(ref(BOARD))
      result.create = useCreateNote(BOARD)
      result.update = useUpdateNote(BOARD)
      result.remove = useDeleteNote(BOARD)
      return () => h('div')
    },
  })

  mount(Harness, { global: { plugins: [pinia, [VueQueryPlugin, { queryClient: client }]] } })
  return result as Mutations
}

/** Mounts a live observer on the future members key (Phase 6 shape). */
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

describe('useNotesQuery', () => {
  let pinia: ReturnType<typeof createPinia>
  let queryClient: QueryClient

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    queryClient = makeQueryClient()
    useToast().clear()
    localStorage.clear()
    clearTokens()
  })

  function mountQuery(boardId: string | string[] | undefined) {
    const param = ref(boardId)
    let result!: ReturnType<typeof useNotesQuery>
    const Harness = defineComponent({
      setup() {
        result = useNotesQuery(param)
        return () => h('div')
      },
    })
    mount(Harness, { global: { plugins: [pinia, [VueQueryPlugin, { queryClient }]] } })
    return { result, param }
  }

  it('lists notes with GET /api/boards/{id}/notes and seeds the cache', async () => {
    server.use(
      http.get(LIST_URL, () => HttpResponse.json([note('n1'), note('n2')])),
    )

    mountQuery(BOARD)
    await settle()

    expect(requestLog.map((entry) => entry.url)).toEqual([LIST_URL])
    expect(queryClient.getQueryData<NoteDto[]>(notesKeys.list(BOARD))).toHaveLength(2)
  })

  it('never retries an API error — a 500 costs exactly one request', async () => {
    server.use(
      http.get(LIST_URL, () => HttpResponse.json({ status: 500 }, { status: 500 })),
    )

    const { result } = mountQuery(BOARD)
    await settle()

    expect(callsTo(LIST_URL, 'GET')).toHaveLength(1)
    expect(result.isError.value).toBe(true)
  })

  it('stays disabled without an id — no request is issued', async () => {
    const { result } = mountQuery(undefined)
    await settle()

    expect(requestLog).toHaveLength(0)
    expect(result.isPending.value).toBe(true)
  })

  it('normalizes an array-shaped route param and switches boards when the id changes', async () => {
    server.use(
      http.get('/api/boards/:boardId/notes', ({ params }) =>
        HttpResponse.json([note(`n-${params.boardId}`)]),
      ),
    )

    const param = ref<string | string[] | undefined>([BOARD])
    let result!: ReturnType<typeof useNotesQuery>
    const Harness = defineComponent({
      setup() {
        result = useNotesQuery(param)
        return () => h('div')
      },
    })
    mount(Harness, { global: { plugins: [pinia, [VueQueryPlugin, { queryClient }]] } })
    await settle()
    expect(requestLog.map((entry) => entry.url)).toEqual([LIST_URL])

    param.value = 'b2'
    await settle()

    expect(requestLog.map((entry) => entry.url)).toEqual([
      LIST_URL,
      API_URLS.notes.list('b2'),
    ])
    expect(result.data.value?.[0]?.id).toBe('n-b2')
  })

  it.each([
    ['403', 403],
    ['404', 404],
  ])('reports an error state for %s (deep-linking a foreign board)', async (_label, status) => {
    server.use(
      http.get(LIST_URL, () => HttpResponse.json({ status, detail: 'nope' }, { status })),
    )

    const { result } = mountQuery(BOARD)
    await settle()

    expect(result.isError.value).toBe(true)
  })
})

describe('useCreateNote', () => {
  let pinia: ReturnType<typeof createPinia>
  let queryClient: QueryClient

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    queryClient = makeQueryClient()
    useToast().clear()
    localStorage.clear()
    clearTokens()
    // Seed the session the way the boards-flow integration does: tokens in
    // memory (refresh token dropped so nothing persists across tests).
    useAuthStore().setTokens(TOKENS)
    localStorage.clear()
    useAuthStore().setUser({ id: 'u1', email: 'a@b.co', displayName: 'Ada' })
  })

  it('shows a temp note while the POST hangs, then swaps it for the real DTO with no temp left', async () => {
    let postBody: unknown
    let authHeader: string | null = null
    let releasePost!: (res: Response) => void
    const stored = [note('n1')]
    server.use(
      http.get(LIST_URL, () => HttpResponse.json(stored)),
      http.post(LIST_URL, async ({ request }) => {
        postBody = await request.json()
        authHeader = request.headers.get('Authorization')
        return new Promise<Response>((resolve) => {
          releasePost = resolve
        })
      }),
    )

    const { create } = mountQueryAndMutations(pinia, queryClient)
    await settle()
    expect(cachedNotes(queryClient)).toHaveLength(1)

    create.mutate({ content: 'Draft', color: 'note-blue', positionX: 12, positionY: 34 })
    await settle()

    // Optimistic temp entry visible while the POST is still hanging.
    expect(create.isPending.value).toBe(true)
    const inFlight = cachedNotes(queryClient)
    expect(inFlight).toHaveLength(2)
    expect(inFlight[1]!.id.startsWith('temp-')).toBe(true)
    expect(inFlight[1]!).toMatchObject({
      content: 'Draft',
      color: 'note-blue',
      positionX: 12,
      positionY: 34,
      createdBy: 'u1',
    })

    // The POST body mirrors CreateNoteRequest exactly, with the bearer token.
    expect(postBody).toEqual({
      content: 'Draft',
      color: 'note-blue',
      positionX: 12,
      positionY: 34,
    })
    expect(authHeader).toBe('Bearer access-1')

    // Synchronous fake-server write BEFORE the POST answers, so the onSettled
    // refetch stays coherent with the swap.
    const created = note('n9', { content: 'Draft', color: 'note-blue', positionX: 12, positionY: 34 })
    stored.push(created)
    releasePost(HttpResponse.json(created))
    await settle()

    const after = cachedNotes(queryClient)
    expect(after.map((item) => item.id)).toEqual(['n1', 'n9'])
    expect(after.some((item) => item.id.startsWith('temp-'))).toBe(false)
  })

  it('rolls the temp note back on 403 with exactly one toast and marks the list invalidated', async () => {
    server.use(
      http.get(LIST_URL, () => new Promise<Response>(() => {})),
      http.post(LIST_URL, () =>
        HttpResponse.json({ status: 403, detail: 'viewer' }, { status: 403 }),
      ),
    )

    const { create } = mountQueryAndMutations(pinia, queryClient)
    await settle()
    // The list GET never lands; seed the cache the way a settled load would.
    queryClient.setQueryData(notesKeys.list(BOARD), [note('n1')])

    await expect(
      create.mutateAsync({ content: 'Nope', color: 'note-pink', positionX: 0, positionY: 0 }),
    ).rejects.toThrow("You don't have permission for this action")
    await settle()

    const after = cachedNotes(queryClient)
    // Rollback restored the snapshot; the temp note is gone for good.
    expect(after.map((item) => item.id)).toEqual(['n1'])
    expect(after.some((item) => item.id.startsWith('temp-'))).toBe(false)
    const toasts = useToast().toasts.value
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.variant).toBe('error')
    expect(toasts[0]!.message).toBe("You don't have permission for this action")
    // The onSettled invalidation landed (its refetch hangs forever by design).
    expect(queryClient.getQueryState(notesKeys.list(BOARD))?.isInvalidated).toBe(true)
  })

  it('does not duplicate the real note when the invalidation lands before the swap', async () => {
    const created = note('n9', { content: 'Draft', color: 'note-blue' })
    server.use(
      http.get(LIST_URL, () => HttpResponse.json([note('n1'), created])),
      http.post(LIST_URL, () => {
        // Simulate the invalidate/refetch race: by the time the POST answers,
        // the cache already holds the REAL note and the temp entry is gone.
        queryClient.setQueryData(notesKeys.list(BOARD), [note('n1'), created])
        return HttpResponse.json(created)
      }),
    )

    const { create } = mountMutations(pinia, queryClient)
    queryClient.setQueryData(notesKeys.list(BOARD), [note('n1')])

    await create.mutateAsync({ content: 'Draft', color: 'note-blue', positionX: 5, positionY: 6 })
    await settle()

    const ids = cachedNotes(queryClient).map((item) => item.id)
    expect(ids.filter((id) => id === 'n9')).toHaveLength(1)
    expect(ids.some((id) => id.startsWith('temp-'))).toBe(false)
  })

  it('keeps untouched notes referentially identical through the temp append and the swap', async () => {
    // Perf rule P3 / AGENTS §8: the optimistic write clones ONLY the touched
    // entry — cards bound to untouched items must not re-render.
    let releasePost!: (res: Response) => void
    server.use(
      http.post(LIST_URL, () => {
        return new Promise<Response>((resolve) => {
          releasePost = resolve
        })
      }),
    )

    const n1 = note('n1')
    const n2 = note('n2')
    const { create } = mountMutations(pinia, queryClient)
    queryClient.setQueryData(notesKeys.list(BOARD), [n1, n2])

    create.mutate({ content: 'Draft', color: 'note-blue', positionX: 1, positionY: 1 })
    await settle()

    // Optimistic append: the two existing objects ride along UNCLONED.
    const inFlight = cachedNotes(queryClient)
    expect(inFlight).toHaveLength(3)
    expect(inFlight[0]).toBe(n1)
    expect(inFlight[1]).toBe(n2)
    expect(inFlight[2]!.id.startsWith('temp-')).toBe(true)

    const created = note('n9', { content: 'Draft' })
    releasePost(HttpResponse.json(created))
    await settle()

    // The swap maps in place: only the temp slot becomes a new object.
    const after = cachedNotes(queryClient)
    expect(after.map((item) => item.id)).toEqual(['n1', 'n2', 'n9'])
    expect(after[0]).toBe(n1)
    expect(after[1]).toBe(n2)
    expect(after[2]).toMatchObject({ id: 'n9', content: 'Draft' })
  })

  it('drops the optimistically seeded list on a failed first create — no temp survives', async () => {
    // The `previous === undefined` branch of onError: there is nothing to roll
    // back TO, so the cache entry itself is removed; the temp note can never
    // outlive the failed POST.
    server.use(
      http.post(LIST_URL, () =>
        HttpResponse.json({ status: 403, detail: 'not a member' }, { status: 403 }),
      ),
    )

    const { create } = mountMutations(pinia, queryClient)

    await expect(
      create.mutateAsync({ content: 'First', color: 'note-yellow', positionX: 0, positionY: 0 }),
    ).rejects.toThrow("You don't have permission for this action")
    await settle()

    expect(queryClient.getQueryData(notesKeys.list(BOARD))).toBeUndefined()
    const toasts = useToast().toasts.value
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.variant).toBe('error')
  })
})

describe('useUpdateNote', () => {
  let pinia: ReturnType<typeof createPinia>
  let queryClient: QueryClient

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    queryClient = makeQueryClient()
    useToast().clear()
    localStorage.clear()
    clearTokens()
  })

  it('applies new content optimistically and sends the FULL request with the unchanged position', async () => {
    let putBody: unknown
    let releasePut!: (res: Response) => void
    const stored = [note('n1', { content: 'Hello', color: 'note-yellow', positionX: 5, positionY: 7 })]
    server.use(
      http.get(LIST_URL, () => HttpResponse.json(stored)),
      http.put(API_URLS.notes.detail('n1'), async ({ request }) => {
        putBody = await request.json()
        return new Promise<Response>((resolve) => {
          releasePut = resolve
        })
      }),
    )

    const { update } = mountQueryAndMutations(pinia, queryClient)
    await settle()

    // Editor-style save: content/color only — position is not touched.
    update.mutate({ id: 'n1', content: 'Edited', color: 'note-blue' })
    await settle()

    const optimistic = cachedNotes(queryClient)[0]!
    expect(optimistic).toMatchObject({
      content: 'Edited',
      color: 'note-blue',
      // unchanged fields survive the optimistic merge untouched
      positionX: 5,
      positionY: 7,
    })

    releasePut(HttpResponse.json(stored[0]!))
    await settle()

    // Wire body is a complete UpdateNoteRequest, position included from cache.
    expect(putBody).toEqual({
      content: 'Edited',
      color: 'note-blue',
      positionX: 5,
      positionY: 7,
    })
  })

  it('builds the body from the freshest cache: a drag after a content edit keeps the new content', async () => {
    const bodies: unknown[] = []
    let release!: (res: Response) => void
    const stored = [note('n1', { content: 'Hello' })]
    server.use(
      http.get(LIST_URL, () => HttpResponse.json(stored)),
      http.put(API_URLS.notes.detail('n1'), async ({ request }) => {
        const body = (await request.json()) as UpdateNoteRequest
        bodies.push(body)
        stored[0] = { ...stored[0]!, ...body }
        return new Promise<Response>((resolve) => {
          release = resolve
        })
      }),
    )

    const { update } = mountQueryAndMutations(pinia, queryClient)
    await settle()

    // 1. content edit starts (optimistic write lands, PUT hangs) ...
    update.mutate({ id: 'n1', content: 'EDITED' })
    await settle()
    release(HttpResponse.json(stored[0]!))
    await settle()

    // 2. ... then a drag-only commit: the body must carry the LATEST content,
    // not anything the card snapshotted before the edit.
    update.mutate({ id: 'n1', positionX: 99, positionY: 88 })
    await settle()
    release(HttpResponse.json(stored[0]!))
    await settle()

    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toEqual({
      content: 'EDITED',
      color: 'note-yellow',
      positionX: 0,
      positionY: 0,
    })
    expect(bodies[1]).toEqual({
      content: 'EDITED',
      color: 'note-yellow',
      positionX: 99,
      positionY: 88,
    })
  })

  it('rolls back before the refetch can mask it on 403 and toasts once', async () => {
    let hang = false
    server.use(
      http.get(LIST_URL, () => {
        // From here on the list refetch never resolves: only the rollback
        // snapshot can repopulate the cache.
        if (hang) return new Promise<Response>(() => {})
        return HttpResponse.json([note('n1', { content: 'Original', positionX: 3, positionY: 4 })])
      }),
      http.put(API_URLS.notes.detail('n1'), () =>
        HttpResponse.json({ status: 403, detail: 'viewer' }, { status: 403 }),
      ),
    )

    const { update } = mountQueryAndMutations(pinia, queryClient)
    await settle()
    expect(cachedNotes(queryClient)[0]!.content).toBe('Original')

    hang = true
    await expect(update.mutateAsync({ id: 'n1', content: 'Hijack' })).rejects.toThrow(
      "You don't have permission for this action",
    )
    await settle()

    // Original optimistic-then-rolled-back values are restored exactly.
    expect(cachedNotes(queryClient)[0]).toMatchObject({
      content: 'Original',
      positionX: 3,
      positionY: 4,
    })
    const toasts = useToast().toasts.value
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.variant).toBe('error')
  })

  it('writes the server-normalized DTO into the cache on success', async () => {
    server.use(
      http.put(API_URLS.notes.detail('n1'), () =>
        HttpResponse.json(
          note('n1', {
            content: 'Padded',
            positionX: 5,
            positionY: 6,
            updatedAt: '2026-02-02T00:00:00Z',
          }),
        ),
      ),
    )

    // No mounted observer: the onSettled invalidation cannot refetch, so the
    // ONLY thing that can put the trimmed content in the cache is onSuccess.
    const { update } = mountMutations(pinia, queryClient)
    queryClient.setQueryData(notesKeys.list(BOARD), [
      note('n1', { content: 'Padded   ', positionX: 5, positionY: 6 }),
    ])

    await update.mutateAsync({ id: 'n1', content: 'Padded   ' })
    await settle()

    const written = cachedNotes(queryClient).find((item) => item.id === 'n1')!
    expect(written.content).toBe('Padded')
    expect(written.updatedAt).toBe('2026-02-02T00:00:00Z')
  })

  it('clones ONLY the touched note in the optimistic write — untouched items keep identity', async () => {
    // Perf rule P3: an optimistic drag/edit must not re-render the cards bound
    // to everyone else's notes. The PUT hangs forever on purpose: this asserts
    // the optimistic write itself, before any server answer.
    server.use(
      http.put(API_URLS.notes.detail('n1'), () => new Promise<Response>(() => {})),
    )

    const n1 = note('n1', { positionX: 5, positionY: 7 })
    const n2 = note('n2')
    const { update } = mountMutations(pinia, queryClient)
    queryClient.setQueryData(notesKeys.list(BOARD), [n1, n2])

    update.mutate({ id: 'n1', positionX: 99, positionY: 88 })
    await settle()

    const optimistic = cachedNotes(queryClient)
    expect(optimistic[0]).not.toBe(n1) // the touched note is a fresh merged object
    expect(optimistic[0]).toMatchObject({
      positionX: 99,
      positionY: 88,
      // unchanged fields ride along from the freshest cached entry
      content: 'Hello',
      color: 'note-yellow',
    })
    expect(optimistic[1]).toBe(n2)
  })
})

describe('useDeleteNote', () => {
  let pinia: ReturnType<typeof createPinia>
  let queryClient: QueryClient

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    queryClient = makeQueryClient()
    useToast().clear()
    localStorage.clear()
    clearTokens()
  })

  it('filters the note out while the DELETE is still in flight', async () => {
    server.use(
      http.get(LIST_URL, () => HttpResponse.json([note('n1'), note('n2')])),
      // A delete that never answers: the cache write must be observable
      // before the server replies, otherwise nothing is "optimistic".
      http.delete(API_URLS.notes.detail('n2'), () => new Promise<Response>(() => {})),
    )

    const { remove } = mountQueryAndMutations(pinia, queryClient)
    await settle()
    expect(cachedNotes(queryClient).map((item) => item.id)).toEqual(['n1', 'n2'])

    const pending = remove.mutateAsync({ noteId: 'n2' })
    await settle()

    expect(remove.isPending.value).toBe(true)
    expect(cachedNotes(queryClient).map((item) => item.id)).toEqual(['n1'])
    void pending
  })

  it('keeps a deleted note gone after 204 and sends exactly one DELETE', async () => {
    const stored = [note('n1'), note('n2')]
    server.use(
      http.get(LIST_URL, () => HttpResponse.json(stored)),
      http.delete(API_URLS.notes.detail('n2'), () => {
        stored.splice(1, 1)
        return new HttpResponse(null, { status: 204 })
      }),
    )

    const { remove } = mountQueryAndMutations(pinia, queryClient)
    await settle()

    await remove.mutateAsync({ noteId: 'n2' })
    await settle()

    expect(cachedNotes(queryClient).map((item) => item.id)).toEqual(['n1'])
    expect(callsTo(API_URLS.notes.detail('n2'), 'DELETE')).toHaveLength(1)
  })

  it('restores the snapshot on 403 with the permission toast', async () => {
    server.use(
      http.get(LIST_URL, () => HttpResponse.json([note('n1'), note('n2')])),
      http.delete(API_URLS.notes.detail('n2'), () =>
        HttpResponse.json({ status: 403, detail: 'not yours' }, { status: 403 }),
      ),
    )

    const { remove } = mountQueryAndMutations(pinia, queryClient)
    await settle()

    await expect(remove.mutateAsync({ noteId: 'n2' })).rejects.toThrow(
      "You don't have permission for this action",
    )
    await settle()

    expect(cachedNotes(queryClient).map((item) => item.id)).toEqual(['n1', 'n2'])
    const toasts = useToast().toasts.value
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.message).toBe("You don't have permission for this action")
  })
})

describe('notes mutation invalidations', () => {
  let pinia: ReturnType<typeof createPinia>
  let queryClient: QueryClient

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    queryClient = makeQueryClient()
    useToast().clear()
    localStorage.clear()
    clearTokens()
    useAuthStore().setTokens(TOKENS)
    localStorage.clear()
    useAuthStore().setUser({ id: 'u1', email: 'a@b.co', displayName: 'Ada' })
  })

  it('invalidates with exact:true on every settle and never refetches sibling keys', async () => {
    let membersFetches = 0
    // The sibling observer owns its own queryFn; it never goes through fetch.
    const membersRoute = async (): Promise<Response> => {
      membersFetches += 1
      return HttpResponse.json([])
    }
    const stored = [note('n1'), note('n2')]
    server.use(
      http.get(LIST_URL, () => HttpResponse.json(stored)),
      http.post(LIST_URL, () => HttpResponse.json(note('n9'))),
      http.put(API_URLS.notes.detail('n1'), () => HttpResponse.json(note('n1'))),
      http.delete(API_URLS.notes.detail('n2'), () => {
        stored.splice(1, 1)
        return new HttpResponse(null, { status: 204 })
      }),
    )

    const { create, update, remove } = mountQueryAndMutations(pinia, queryClient)
    // A live observer on the future members key (Phase 6 shape) sharing the cache.
    mountSiblingObserver(pinia, queryClient, ['boards', BOARD, 'members'], membersRoute)
    await settle()
    expect(membersFetches).toBe(1)

    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await create.mutateAsync({ content: 'New', color: 'note-blue', positionX: 1, positionY: 2 })
    await settle()
    await update.mutateAsync({ id: 'n1', content: 'Renamed' })
    await settle()
    await remove.mutateAsync({ noteId: 'n2' })
    await settle()

    // Every invalidation this feature issues is prefix-exact: none may stale
    // ['boards'] details or the ['boards', id, 'members'] cache.
    const exactFlags = invalidate.mock.calls.map(([filters]) =>
      typeof filters === 'function' ? undefined : filters?.exact,
    )
    expect(exactFlags.length).toBeGreaterThan(0)
    expect(exactFlags.every((exact) => exact === true)).toBe(true)

    // exact:true on the notes list key never reached the members key.
    expect(membersFetches).toBe(1)
  })
})
