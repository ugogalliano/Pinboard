import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, ref } from 'vue'
import { useToast } from '@ugogalliano/pm-design-system-vue'

import {
  useAddMember,
  useCurrentBoardRole,
  useMembersQuery,
  useRemoveMember,
  useUpdateMember,
} from '@/features/members'
import { boardsKeys as featureBoardsKeys } from '@/features/boards'
import { boardsKeys } from '@/shared/constants/board-query-keys'
import { membersKeys } from './useMembers'
import { useAuthStore } from '@/stores/authStore'
import { API_URLS } from '@/shared/constants/urls'
import { server } from '../../../../test/msw/server'
import { callsTo, requestLog } from '../../../../test/msw/requests'
import type { BoardDto, BoardMemberDto } from '@/shared/types/api'

const BOARD = 'b1'
const MEMBERS_URL = API_URLS.members.list(BOARD)

function member(userId: string, role: BoardMemberDto['role'] = 'Editor'): BoardMemberDto {
  return {
    userId,
    email: `${userId}@example.com`,
    displayName: userId,
    role,
    createdAt: '2026-01-01T00:00:00Z',
  }
}

function board(id: string): BoardDto {
  return {
    id,
    name: id,
    createdBy: 'creator',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    memberCount: 2,
  }
}

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
  add: ReturnType<typeof useAddMember>
  update: ReturnType<typeof useUpdateMember>
  remove: ReturnType<typeof useRemoveMember>
}

function mountMutations(pinia: ReturnType<typeof createPinia>, client: QueryClient): Mutations {
  const result: Partial<Mutations> = {}
  const Harness = defineComponent({
    setup() {
      result.add = useAddMember(BOARD)
      result.update = useUpdateMember(BOARD)
      result.remove = useRemoveMember(BOARD)
      return () => h('div')
    },
  })

  mount(Harness, { global: { plugins: [pinia, [VueQueryPlugin, { queryClient: client }]] } })
  return result as Mutations
}

describe('useMembersQuery', () => {
  let pinia: ReturnType<typeof createPinia>
  let queryClient: QueryClient

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    queryClient = makeQueryClient()
    useToast().clear()
  })

  it('uses the shared members key and preserves the public boards key values', () => {
    expect(membersKeys.list(BOARD)).toEqual(['boards', BOARD, 'members'])
    expect(membersKeys.list(BOARD)).toEqual(['boards', 'b1', 'members'])
    expect(boardsKeys.all).toEqual(['boards'])
    expect(boardsKeys.detail(BOARD)).toEqual(['boards', BOARD])
    expect(featureBoardsKeys).toBe(boardsKeys)
  })

  it('lists members with GET and isolates the cache by board', async () => {
    server.use(
      http.get('/api/boards/:boardId/members', ({ params }) =>
        HttpResponse.json([member(`u-${params.boardId}`)]),
      ),
    )

    const boardId = ref<string | string[] | undefined>([BOARD])
    const Harness = defineComponent({
      setup() {
        useMembersQuery(boardId)
        return () => h('div')
      },
    })
    mount(Harness, { global: { plugins: [pinia, [VueQueryPlugin, { queryClient }]] } })
    await settle()

    expect(callsTo(MEMBERS_URL, 'GET')).toHaveLength(1)
    expect(queryClient.getQueryData<BoardMemberDto[]>(membersKeys.list(BOARD))).toEqual([
      member(`u-${BOARD}`),
    ])

    boardId.value = 'b2'
    await settle()

    expect(requestLog.map((entry) => entry.url)).toEqual([MEMBERS_URL, API_URLS.members.list('b2')])
    expect(queryClient.getQueryData<BoardMemberDto[]>(membersKeys.list('b2'))).toEqual([
      member('u-b2'),
    ])
  })

  it('does not fetch when the route id is missing', async () => {
    const Harness = defineComponent({
      setup() {
        useMembersQuery(undefined)
        return () => h('div')
      },
    })
    mount(Harness, { global: { plugins: [pinia, [VueQueryPlugin, { queryClient }]] } })
    await settle()

    expect(requestLog).toHaveLength(0)
  })

  it('exposes the signed-in user role from this board members query, not board ownership', async () => {
    useAuthStore().setUser({ id: 'u2', email: 'u2@example.com', displayName: 'User 2' })
    server.use(http.get(MEMBERS_URL, () => HttpResponse.json([member('creator', 'Owner'), member('u2', 'Viewer')])))
    const boardId = ref<string | string[] | undefined>(BOARD)
    let role!: ReturnType<typeof useCurrentBoardRole>
    const Harness = defineComponent({
      setup() {
        useMembersQuery(boardId)
        role = useCurrentBoardRole(boardId)
        return () => h('div')
      },
    })
    mount(Harness, { global: { plugins: [pinia, [VueQueryPlugin, { queryClient }]] } })
    await settle()

    expect(role.value).toBe('Viewer')
  })

  it('returns null when the signed-in member has an unrecognized runtime role', async () => {
    useAuthStore().setUser({ id: 'u9', email: 'u9@example.com', displayName: 'User 9' })
    const invalidRoleMember = {
      ...member('u9'),
      role: 'Administrator',
    } as unknown as BoardMemberDto
    server.use(http.get(MEMBERS_URL, () => HttpResponse.json([invalidRoleMember])))
    let role!: ReturnType<typeof useCurrentBoardRole>
    const Harness = defineComponent({
      setup() {
        role = useCurrentBoardRole(BOARD)
        return () => h('div')
      },
    })
    mount(Harness, { global: { plugins: [pinia, [VueQueryPlugin, { queryClient }]] } })
    await settle()

    expect(role.value).toBeNull()
  })

  it('returns null for unknown membership and while a new board role is loading', async () => {
    useAuthStore().setUser({ id: 'u2', email: 'u2@example.com', displayName: 'User 2' })
    server.use(
      http.get('/api/boards/:boardId/members', ({ params }) => {
        if (params.boardId === BOARD) return HttpResponse.json([member('u2', 'Editor')])
        return new Promise<Response>(() => {})
      }),
    )
    const boardId = ref<string | string[] | undefined>(BOARD)
    let role!: ReturnType<typeof useCurrentBoardRole>
    const Harness = defineComponent({
      setup() {
        useMembersQuery(boardId)
        role = useCurrentBoardRole(boardId)
        return () => h('div')
      },
    })
    mount(Harness, { global: { plugins: [pinia, [VueQueryPlugin, { queryClient }]] } })
    await settle()
    expect(role.value).toBe('Editor')

    useAuthStore().setUser({ id: 'u9', email: 'u9@example.com', displayName: 'User 9' })
    expect(role.value).toBeNull()

    useAuthStore().setUser({ id: 'u2', email: 'u2@example.com', displayName: 'User 2' })
    boardId.value = 'b2'
    await settle()
    expect(role.value).toBeNull()
  })

  it('returns null without an auth user or during and after a query error', async () => {
    useAuthStore().setUser({ id: 'u9', email: 'u9@example.com', displayName: 'User 9' })
    let role!: ReturnType<typeof useCurrentBoardRole>
    const Harness = defineComponent({
      setup() {
        useMembersQuery(BOARD)
        role = useCurrentBoardRole(BOARD)
        return () => h('div')
      },
    })
    server.use(http.get(MEMBERS_URL, () => HttpResponse.json({ status: 403 }, { status: 403 })))
    mount(Harness, { global: { plugins: [pinia, [VueQueryPlugin, { queryClient }]] } })

    expect(role.value).toBeNull()
    await settle()
    expect(role.value).toBeNull()

    // A known cached member is still not authorized when there is no auth user.
    queryClient.setQueryData(membersKeys.list(BOARD), [member('u9', 'Owner')])
    useAuthStore().setUser(null)
    expect(role.value).toBeNull()
  })
})

describe('useAddMember', () => {
  let pinia: ReturnType<typeof createPinia>
  let queryClient: QueryClient

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    queryClient = makeQueryClient()
    useToast().clear()
  })

  it('uses the response DTO instead of a fabricated optimistic member and sends the POST body', async () => {
    let postBody: unknown
    let releasePost!: (response: Response) => void
    const existing = member('u1')
    const created = member('u2', 'Viewer')
    server.use(
      http.post(MEMBERS_URL, async ({ request }) => {
        postBody = await request.json()
        return new Promise<Response>((resolve) => {
          releasePost = resolve
        })
      }),
    )
    const { add } = mountMutations(pinia, queryClient)
    queryClient.setQueryData(membersKeys.list(BOARD), [existing])

    const pending = add.mutateAsync({ email: 'new@example.com', role: 'Viewer' })
    await settle()
    expect(add.isPending.value).toBe(true)
    expect(queryClient.getQueryData(membersKeys.list(BOARD))).toEqual([existing])
    expect(postBody).toEqual({ email: 'new@example.com', role: 'Viewer' })

    releasePost(HttpResponse.json(created))
    await pending
    expect(queryClient.getQueryData<BoardMemberDto[]>(membersKeys.list(BOARD))).toEqual([
      existing,
      created,
    ])
    expect(callsTo(MEMBERS_URL, 'POST')).toHaveLength(1)
  })

  it('shows one mapped toast on failure and invalidates exact member/list/detail keys', async () => {
    server.use(
      http.post(MEMBERS_URL, () =>
        HttpResponse.json({ status: 403, detail: 'owner only' }, { status: 403 }),
      ),
    )
    const { add } = mountMutations(pinia, queryClient)
    queryClient.setQueryData(boardsKeys.all, [board(BOARD)])
    queryClient.setQueryData(boardsKeys.detail(BOARD), board(BOARD))
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await expect(add.mutateAsync({ email: 'new@example.com', role: 'Editor' })).rejects.toThrow(
      "You don't have permission for this action",
    )
    await settle()

    expect(invalidate.mock.calls.map(([filters]) => filters)).toEqual([
      { queryKey: membersKeys.list(BOARD), exact: true },
      { queryKey: boardsKeys.all, exact: true },
      { queryKey: boardsKeys.detail(BOARD), exact: true },
    ])
    expect(queryClient.getQueryData<BoardDto[]>(boardsKeys.all)?.[0]?.memberCount).toBe(2)
    expect(queryClient.getQueryData<BoardDto>(boardsKeys.detail(BOARD))?.memberCount).toBe(2)
    expect(useToast().toasts.value).toHaveLength(1)
    expect(useToast().toasts.value[0]?.message).toBe("You don't have permission for this action")
  })
})

describe('useUpdateMember', () => {
  let pinia: ReturnType<typeof createPinia>
  let queryClient: QueryClient

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    queryClient = makeQueryClient()
    useToast().clear()
  })

  it('optimistically updates the matching role, sends PUT, and accepts the response DTO', async () => {
    let putBody: unknown
    let releasePut!: (response: Response) => void
    const before = [member('u1'), member('u2', 'Viewer')]
    const updated = member('u1', 'Viewer')
    server.use(
      http.put(API_URLS.members.detail(BOARD, 'u1'), async ({ request }) => {
        putBody = await request.json()
        return new Promise<Response>((resolve) => {
          releasePut = resolve
        })
      }),
    )
    const { update } = mountMutations(pinia, queryClient)
    queryClient.setQueryData(membersKeys.list(BOARD), before)

    const pending = update.mutateAsync({ userId: 'u1', role: 'Viewer' })
    await settle()
    const optimistic = queryClient.getQueryData<BoardMemberDto[]>(membersKeys.list(BOARD))!
    expect(optimistic[0]?.role).toBe('Viewer')
    expect(optimistic[1]).toBe(before[1])
    expect(putBody).toEqual({ role: 'Viewer' })

    releasePut(HttpResponse.json(updated))
    await pending
    expect(queryClient.getQueryData<BoardMemberDto[]>(membersKeys.list(BOARD))?.[0]).toEqual(updated)
    expect(callsTo(API_URLS.members.detail(BOARD, 'u1'), 'PUT')).toHaveLength(1)
  })

  it('rolls back a failed role update, toasts once, and invalidates only the exact members key', async () => {
    server.use(
      http.put(API_URLS.members.detail(BOARD, 'u1'), () =>
        HttpResponse.json({ status: 403, detail: 'owner only' }, { status: 403 }),
      ),
    )
    const before = [member('u1'), member('u2', 'Viewer')]
    const { update } = mountMutations(pinia, queryClient)
    queryClient.setQueryData(membersKeys.list(BOARD), before)
    queryClient.setQueryData(boardsKeys.all, [board(BOARD)])
    queryClient.setQueryData(boardsKeys.detail(BOARD), board(BOARD))
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await expect(update.mutateAsync({ userId: 'u1', role: 'Viewer' })).rejects.toThrow(
      "You don't have permission for this action",
    )
    await settle()

    expect(queryClient.getQueryData(membersKeys.list(BOARD))).toEqual(before)
    expect(invalidate.mock.calls.map(([filters]) => filters)).toEqual([
      { queryKey: membersKeys.list(BOARD), exact: true },
    ])
    expect(queryClient.getQueryData<BoardDto[]>(boardsKeys.all)?.[0]?.memberCount).toBe(2)
    expect(queryClient.getQueryData<BoardDto>(boardsKeys.detail(BOARD))?.memberCount).toBe(2)
    expect(useToast().toasts.value).toHaveLength(1)
    expect(useToast().toasts.value[0]?.variant).toBe('error')
  })
})

describe('useRemoveMember', () => {
  let pinia: ReturnType<typeof createPinia>
  let queryClient: QueryClient

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    queryClient = makeQueryClient()
    useToast().clear()
  })

  it('optimistically removes the member and sends DELETE, accepting 204', async () => {
    let releaseDelete!: (response: Response) => void
    const existing = [member('u1'), member('u2', 'Viewer')]
    server.use(
      http.delete(API_URLS.members.detail(BOARD, 'u2'), () =>
        new Promise<Response>((resolve) => {
          releaseDelete = resolve
        }),
      ),
    )
    const { remove } = mountMutations(pinia, queryClient)
    queryClient.setQueryData(membersKeys.list(BOARD), existing)
    queryClient.setQueryData(boardsKeys.all, [board(BOARD)])
    queryClient.setQueryData(boardsKeys.detail(BOARD), board(BOARD))

    const pending = remove.mutateAsync('u2')
    await settle()
    expect(queryClient.getQueryData<BoardMemberDto[]>(membersKeys.list(BOARD))).toEqual([existing[0]])

    releaseDelete(new HttpResponse(null, { status: 204 }))
    await pending
    expect(callsTo(API_URLS.members.detail(BOARD, 'u2'), 'DELETE')).toHaveLength(1)
    expect(queryClient.getQueryData<BoardDto[]>(boardsKeys.all)?.[0]?.memberCount).toBe(2)
    expect(queryClient.getQueryData<BoardDto>(boardsKeys.detail(BOARD))?.memberCount).toBe(2)
  })

  it('rolls back a failed delete, toasts once, and invalidates exact member/list/detail keys', async () => {
    server.use(
      http.delete(API_URLS.members.detail(BOARD, 'u2'), () =>
        HttpResponse.json({ status: 403, detail: 'owner only' }, { status: 403 }),
      ),
    )
    const before = [member('u1'), member('u2', 'Viewer')]
    const { remove } = mountMutations(pinia, queryClient)
    queryClient.setQueryData(membersKeys.list(BOARD), before)
    queryClient.setQueryData(boardsKeys.all, [board(BOARD)])
    queryClient.setQueryData(boardsKeys.detail(BOARD), board(BOARD))
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await expect(remove.mutateAsync('u2')).rejects.toThrow(
      "You don't have permission for this action",
    )
    await settle()

    expect(queryClient.getQueryData(membersKeys.list(BOARD))).toEqual(before)
    expect(invalidate.mock.calls.map(([filters]) => filters)).toEqual([
      { queryKey: membersKeys.list(BOARD), exact: true },
      { queryKey: boardsKeys.all, exact: true },
      { queryKey: boardsKeys.detail(BOARD), exact: true },
    ])
    expect(useToast().toasts.value).toHaveLength(1)
    expect(useToast().toasts.value[0]?.message).toBe("You don't have permission for this action")
  })
})
