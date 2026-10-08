import { describe, expect, it } from 'vitest'

import { queryClient } from './queryClient'
import { ApiError } from '@/shared/services/api'

describe('queryClient defaults', () => {
  const defaults = queryClient.getDefaultOptions()

  it('applies the PLAN.FE.md §8 query defaults', () => {
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false)
    expect(defaults.queries?.staleTime).toBe(30_000)
  })

  it('never retries ApiError, retries network errors once', () => {
    expect(typeof defaults.queries?.retry).toBe('function')
    const retry = defaults.queries?.retry as (count: number, error: unknown) => boolean

    const apiError = new ApiError(500, { status: 500 })
    expect(retry(0, apiError)).toBe(false)

    const networkError = new TypeError('Failed to fetch')
    expect(retry(0, networkError)).toBe(true)
    expect(retry(1, networkError)).toBe(false)
  })

  it('disables mutation retries', () => {
    expect(defaults.mutations?.retry).toBe(false)
  })
})
