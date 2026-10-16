import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { useToast } from '@ugogalliano/pm-design-system-vue'
import { computed, toValue, type MaybeRef } from 'vue'

import { boardsKeys } from '@/shared/constants/board-query-keys'
import { HTTP_METHODS } from '@/shared/constants/constants'
import { normalizeRouteId } from '@/shared/composables/normalizeRouteId'
import { API_URLS } from '@/shared/constants/urls'
import { apiClient, mapApiErrorToMessage } from '@/shared/services/api'
import type {
  AddMemberRequest,
  BoardMemberDto,
  BoardRole,
  UpdateMemberRequest,
} from '@/shared/types/api'
import { useAuthStore } from '@/stores/authStore'

/** Members query keys — one isolated list for each board. */
export const membersKeys = {
  list: (boardId: string) => ['boards', boardId, 'members'] as const,
}

type UpdateMemberValues = UpdateMemberRequest & { userId: string }

interface MemberSnapshot {
  previous: BoardMemberDto[] | undefined
}

/** GET /api/boards/{boardId}/members; route params are normalized once. */
export function useMembersQuery(boardId: MaybeRef<string | string[] | undefined>) {
  const id = computed(() => normalizeRouteId(boardId))

  return useQuery({
    queryKey: computed(() => membersKeys.list(id.value ?? '')),
    queryFn: () =>
      apiClient<BoardMemberDto[]>(HTTP_METHODS.GET, API_URLS.members.list(id.value ?? '')),
    enabled: () => id.value !== undefined,
  })
}

/**
 * The current user's role comes only from the same-board members query.
 * Missing, pending, refetching, failed, or unknown membership is fail-closed.
 */
export function useCurrentBoardRole(
  boardId: MaybeRef<string | string[] | undefined>,
) {
  const id = computed(() => normalizeRouteId(boardId))
  const members = useMembersQuery(boardId)
  const authStore = useAuthStore()

  return computed<BoardRole | null>(() => {
    if (
      id.value === undefined ||
      members.isPending.value ||
      members.isFetching.value ||
      members.isError.value
    ) {
      return null
    }

    const userId = authStore.user?.id
    if (!userId) return null

    const role = members.data.value?.find((item) => item.userId === userId)?.role
    return role === 'Owner' || role === 'Editor' || role === 'Viewer' ? role : null
  })
}

/** POST /api/boards/{boardId}/members; the server DTO is authoritative. */
export function useAddMember(boardId: MaybeRef<string>) {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: (values: AddMemberRequest) =>
      apiClient<BoardMemberDto>(
        HTTP_METHODS.POST,
        API_URLS.members.list(toValue(boardId)),
        values,
      ),
    onSuccess: (created) => {
      if (!created) return

      const key = membersKeys.list(toValue(boardId))
      const members = queryClient.getQueryData<BoardMemberDto[]>(key)
      if (!members) {
        queryClient.setQueryData(key, [created])
        return
      }

      const existingIndex = members.findIndex((item) => item.userId === created.userId)
      queryClient.setQueryData(
        key,
        existingIndex < 0
          ? [...members, created]
          : members.map((item) => (item.userId === created.userId ? created : item)),
      )
    },
    onError: (error) => {
      toast({ variant: 'error', message: mapApiErrorToMessage(error) })
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: membersKeys.list(toValue(boardId)),
        exact: true,
      })
      void queryClient.invalidateQueries({ queryKey: boardsKeys.all, exact: true })
      void queryClient.invalidateQueries({
        queryKey: boardsKeys.detail(toValue(boardId)),
        exact: true,
      })
    },
  })
}

/** PUT /api/boards/{boardId}/members/{userId}, optimistically updating role. */
export function useUpdateMember(boardId: MaybeRef<string>) {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: ({ userId, role }: UpdateMemberValues) =>
      apiClient<BoardMemberDto>(
        HTTP_METHODS.PUT,
        API_URLS.members.detail(toValue(boardId), userId),
        { role },
      ),
    onMutate: async ({ userId, role }) => {
      const key = membersKeys.list(toValue(boardId))
      await queryClient.cancelQueries({ queryKey: key, exact: true })
      const previous = queryClient.getQueryData<BoardMemberDto[]>(key)
      if (previous) {
        queryClient.setQueryData(
          key,
          previous.map((item) => (item.userId === userId ? { ...item, role } : item)),
        )
      }
      return { previous } satisfies MemberSnapshot
    },
    onSuccess: (updated) => {
      if (!updated) return

      const key = membersKeys.list(toValue(boardId))
      const members = queryClient.getQueryData<BoardMemberDto[]>(key)
      if (!members) {
        queryClient.setQueryData(key, [updated])
        return
      }

      const existingIndex = members.findIndex((item) => item.userId === updated.userId)
      queryClient.setQueryData(
        key,
        existingIndex < 0
          ? [...members, updated]
          : members.map((item) => (item.userId === updated.userId ? updated : item)),
      )
    },
    onError: (error, _values, context) => {
      if (context?.previous) {
        queryClient.setQueryData(membersKeys.list(toValue(boardId)), context.previous)
      }
      toast({ variant: 'error', message: mapApiErrorToMessage(error) })
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: membersKeys.list(toValue(boardId)),
        exact: true,
      })
    },
  })
}

/** DELETE /api/boards/{boardId}/members/{userId} (204). */
export function useRemoveMember(boardId: MaybeRef<string>) {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: (userId: string) =>
      apiClient<void>(HTTP_METHODS.DELETE, API_URLS.members.detail(toValue(boardId), userId)),
    onMutate: async (userId) => {
      const key = membersKeys.list(toValue(boardId))
      await queryClient.cancelQueries({ queryKey: key, exact: true })
      const previous = queryClient.getQueryData<BoardMemberDto[]>(key)
      if (previous) {
        queryClient.setQueryData(
          key,
          previous.filter((item) => item.userId !== userId),
        )
      }
      return { previous } satisfies MemberSnapshot
    },
    onError: (error, _userId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(membersKeys.list(toValue(boardId)), context.previous)
      }
      toast({ variant: 'error', message: mapApiErrorToMessage(error) })
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: membersKeys.list(toValue(boardId)),
        exact: true,
      })
      void queryClient.invalidateQueries({ queryKey: boardsKeys.all, exact: true })
      void queryClient.invalidateQueries({
        queryKey: boardsKeys.detail(toValue(boardId)),
        exact: true,
      })
    },
  })
}
