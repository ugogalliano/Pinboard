import { beforeEach, describe, expect, it } from 'vitest'
import { computed, effectScope } from 'vue'

import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
} from './token'

describe('token storage', () => {
  beforeEach(() => {
    localStorage.clear()
    clearTokens()
  })

  it('keeps the access token in memory only — never in localStorage', () => {
    setAccessToken('access-secret')

    expect(getAccessToken()).toBe('access-secret')
    // localStorage must contain nothing at all while only an access token is set.
    expect(localStorage.length).toBe(0)
  })

  it('persists the refresh token to localStorage', () => {
    setRefreshToken('refresh-1')

    expect(getRefreshToken()).toBe('refresh-1')
    expect(localStorage.getItem('postit.refreshToken')).toBe('refresh-1')
  })

  it('setRefreshToken(null) removes the persisted token', () => {
    setRefreshToken('refresh-1')
    setRefreshToken(null)

    expect(getRefreshToken()).toBeNull()
    expect(localStorage.getItem('postit.refreshToken')).toBeNull()
  })

  it('clearTokens clears both access and refresh tokens', () => {
    setAccessToken('access-secret')
    setRefreshToken('refresh-1')

    clearTokens()

    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
    expect(localStorage.length).toBe(0)
  })

  it('getAccessToken is reactive (module-level Vue ref)', () => {
    const scope = effectScope()
    const current = scope.run(() => computed(() => getAccessToken()))
    expect(current?.value).toBeNull()

    setAccessToken('reactive-token')
    expect(current?.value).toBe('reactive-token')

    clearTokens()
    expect(current?.value).toBeNull()
    scope.stop()
  })

  it('overwriting the access token never writes it under any storage key', () => {
    setAccessToken('first')
    setAccessToken('second')
    setRefreshToken('r')

    expect(getAccessToken()).toBe('second')
    const persisted = Object.keys(localStorage).map((k) => localStorage.getItem(k))
    expect(persisted.every((v) => !v?.includes('first') && !v?.includes('second'))).toBe(true)
  })
})
