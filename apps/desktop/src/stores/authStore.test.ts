import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useAuthStore } from './authStore'
import { getAccessToken, getRefreshToken, setRefreshToken } from '@/shared/services/token'
import type { LoginResponse, MeResponse } from '@/shared/types/api'

const TOKENS: LoginResponse = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: '2026-01-01T00:00:00Z',
}

const USER: MeResponse = { id: 'u1', email: 'a@b.co', displayName: 'Ada' }

describe('authStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    const store = useAuthStore()
    store.clearAuth()
  })

  it('is not authenticated with only a refresh token present', () => {
    setRefreshToken('refresh-only')

    const store = useAuthStore()

    expect(store.isAuthenticated).toBe(false)
    expect(store.user).toBeNull()
    expect(store.isLoading).toBe(false)
  })

  it('is not authenticated with an access token but no user', () => {
    const store = useAuthStore()
    store.setTokens(TOKENS)

    expect(getAccessToken()).toBe('access-1')
    expect(store.isAuthenticated).toBe(false)
  })

  it('is authenticated after setTokens + setUser, persisting via token.ts', () => {
    const store = useAuthStore()

    store.setTokens(TOKENS)
    store.setUser(USER)

    expect(store.isAuthenticated).toBe(true)
    expect(getAccessToken()).toBe('access-1')
    expect(getRefreshToken()).toBe('refresh-1')
    expect(store.user).toEqual(USER)
  })

  it('clearAuth resets the user and empties token.ts (memory + localStorage)', () => {
    const store = useAuthStore()
    store.setTokens(TOKENS)
    store.setUser(USER)

    store.clearAuth()

    expect(store.user).toBeNull()
    expect(store.isAuthenticated).toBe(false)
    expect(getAccessToken()).toBeNull()
    expect(localStorage.getItem('postit.refreshToken')).toBeNull()
  })

  it('setLoading toggles the loading flag', () => {
    const store = useAuthStore()

    store.setLoading(true)
    expect(store.isLoading).toBe(true)

    store.setLoading(false)
    expect(store.isLoading).toBe(false)
  })
})
