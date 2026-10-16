import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { useToast } from '@ugogalliano/pm-design-system-vue'

import { apiClient, mapApiErrorToMessage } from '@/shared/services/api'
import { HTTP_METHODS } from '@/shared/constants/constants'
import { API_URLS } from '@/shared/constants/urls'
import { boardsKeys } from '@/shared/constants/board-query-keys'
import { useAuthStore } from '@/stores/authStore'
import type { BoardDto, CreateBoardRequest, UpdateBoardRequest } from '@/shared/types/api'

export { boardsKeys } from '@/shared/constants/board-query-keys'

/** Values accepted by the create mutation (mirrors `CreateBoardRequest`). */
export type CreateBoardValues = CreateBoardRequest

/** Values accepted by the update mutation (the id rides along the payload). */
export type UpdateBoardValues = UpdateBoardRequest & { id: string }

/** GET /api/boards → the boards the current user is a member of. */
export function useBoards() {
  return useQuery({
    queryKey: boardsKeys.all,
    queryFn: () => apiClient<BoardDto[]>(HTTP_METHODS.GET, API_URLS.boards.list),
  })
}

/**
 * POST /api/boards. The response is authoritative (server may normalize the
 * name), so the list is invalidated rather than optimistically seeded — the
 * refetch in `onSettled` is the single source of truth.
 */
export function useCreateBoard() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: (values: CreateBoardValues) =>
      apiClient<BoardDto>(HTTP_METHODS.POST, API_URLS.boards.list, values),
    onError: (err) => {
      toast({ variant: 'error', message: mapApiErrorToMessage(err) })
    },
    onSettled: () => {
      // `exact: true` is mandatory: a non-exact prefix match on ['boards']
      // would also stale the detail key and the future
      // ['boards', id, 'notes'] / ['boards', id, 'members'] caches.
      void queryClient.invalidateQueries({ queryKey: boardsKeys.all, exact: true })
    },
  })
}

/**
 * PUT /api/boards/{id}. The returned BoardDto is written straight into both
 * the detail and the list cache so the UI is consistent before the
 * `onSettled` refetch lands.
 */
export function useUpdateBoard() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: ({ id, name }: UpdateBoardValues) =>
      apiClient<BoardDto>(HTTP_METHODS.PUT, API_URLS.boards.detail(id), { name }),
    onSuccess: (board) => {
      if (!board) return
      queryClient.setQueryData(boardsKeys.detail(board.id), board)
      const boards = queryClient.getQueryData<BoardDto[]>(boardsKeys.all)
      if (boards) {
        queryClient.setQueryData(
          boardsKeys.all,
          boards.map((item) => (item.id === board.id ? board : item)),
        )
      }
    },
    onError: (err) => {
      toast({ variant: 'error', message: mapApiErrorToMessage(err) })
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: boardsKeys.all, exact: true })
    },
  })
}

/**
 * DELETE /api/boards/{id} with the full optimistic cycle: cancel in-flight
 * reads, remove the board from the list, roll the snapshot back on failure
 * and drop the detail entry on success.
 */
export function useDeleteBoard() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: (id: string) => apiClient<void>(HTTP_METHODS.DELETE, API_URLS.boards.detail(id)),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: boardsKeys.all })
      const previous = queryClient.getQueryData<BoardDto[]>(boardsKeys.all)
      if (previous) {
        queryClient.setQueryData(
          boardsKeys.all,
          previous.filter((board) => board.id !== id),
        )
      }
      return { previous }
    },
    onError: (err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(boardsKeys.all, context.previous)
      }
      toast({ variant: 'error', message: mapApiErrorToMessage(err) })
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: boardsKeys.detail(id), exact: true })
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: boardsKeys.all, exact: true })
    },
  })
}

/**
 * Can the current user manage (rename / delete) this board? Update and
 * delete are Owner-only on the backend, and under the current contract
 * Owner ⟺ creator: `BoardService` adds the creator as Owner, and
 * `BoardRole.Owner` is neither assignable nor transferable — so
 * `board.createdBy === user.id` is an exact Owner test.
 *
 * Fail-closed: no user (or no board) means no management actions. Phase 6
 * replaces this with the role from the members query. The check lives here
 * so no component repeats it.
 */
export function canManageBoard(board: BoardDto): boolean {
  const userId = useAuthStore().user?.id
  return userId !== null && userId !== undefined && board.createdBy === userId
}
