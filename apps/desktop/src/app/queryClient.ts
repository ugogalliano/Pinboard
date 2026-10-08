import { QueryClient } from '@tanstack/vue-query'

import { ApiError } from '@/shared/services/api'

// Singleton QueryClient installed in main.ts (PLAN.FE.md §8). Feature
// composables must rely on injection (useQuery/useMutation) — never import
// this instance directly.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // One retry for network errors only — never for ApiError (the backend
      // already decided; 4xx/5xx are final).
      retry: (failureCount, error) => !(error instanceof ApiError) && failureCount < 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
    mutations: {
      retry: false,
    },
  },
})
