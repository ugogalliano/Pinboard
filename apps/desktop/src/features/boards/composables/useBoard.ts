import { keepPreviousData, useQuery } from '@tanstack/vue-query'
import { computed, toValue, type MaybeRef } from 'vue'

import { apiClient } from '@/shared/services/api'
import { HTTP_METHODS } from '@/shared/constants/constants'
import { API_URLS } from '@/shared/constants/urls'
import type { BoardDto } from '@/shared/types/api'
import { boardsKeys } from './useBoards'

/**
 * Route params arrive as `string | string[]` (and can be missing entirely),
 * so the raw param is normalized ONCE, here, instead of at every call site.
 */
function normalizeBoardId(id: MaybeRef<string | string[] | undefined>): string | undefined {
  const value = toValue(id)
  if (typeof value === 'string') {
    return value === '' ? undefined : value
  }
  return Array.isArray(value) ? value[0] : undefined
}

/**
 * GET /api/boards/{id} → the single board behind the `:boardId` route param.
 * `enabled` guards the param-less case (no fetch, still `isPending`) and
 * `keepPreviousData` keeps the previous board on screen while a new one
 * loads, so switching boards never flashes an empty header.
 */
export function useBoard(boardId: MaybeRef<string | string[] | undefined>) {
  const id = computed(() => normalizeBoardId(boardId))

  return useQuery({
    queryKey: computed(() => boardsKeys.detail(id.value ?? '')),
    queryFn: () =>
      apiClient<BoardDto>(HTTP_METHODS.GET, API_URLS.boards.detail(id.value ?? '')),
    enabled: () => id.value !== undefined,
    placeholderData: keepPreviousData,
  })
}
