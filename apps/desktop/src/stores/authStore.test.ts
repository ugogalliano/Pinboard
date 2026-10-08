import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useToast } from '@ugogalliano/pm-design-system-vue'

import { useAuthStore } from './authStore'
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setRefreshToken,
} from '@/shared/services/token'
import { apiClient, ApiError, isApiError, isProfileLoadError } from '@/shared/services/api'
import { clearSessionTerminatedHandlers } from '@/shared/services/session'
import { queryClient } from '@/app/queryClient'
import type { LoginResponse, MeResponse } from '@/shared/types/api'

const TOKENS: LoginResponse = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: '2026-01-01T00:00:00Z',
}

const USER: MeResponse = { id: 'u1', email: 'a@b.co', displayName: 'Ada' }

describe('authStore', () => {
  beforeEach(() => {
    clearSessionTerminatedHandlers()
    setActivePinia(createPinia())
    localStorage.clear()
    clearTokens()
    queryClient.clear()
    const store = useAuthStore()
    store.clearAuth()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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

  // ── Network actions (Phase 3) ────────────────────────────────────────
  // Exercised end-to-end through apiClient with a stubbed global fetch, so
  // the real refresh-skip rules and token plumbing are covered too.
})

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text) as unknown,
  } as unknown as Response
}

interface RecordedCall {
  url: string
  method?: string
  body?: string
}

/** Routes /api/auth/* to per-endpoint responses and records every call. */
function stubAuthFetch(handlers: Partial<Record<string, () => Response>>): RecordedCall[] {
  const calls: RecordedCall[] = []
  const fetchMock = vi.fn<FetchImpl>(async (url, init) => {
    calls.push({ url: String(url), method: init?.method, body: init?.body as string | undefined })
    const handler = handlers[String(url)]
    if (!handler) {
      return jsonResponse(500, { status: 500, title: 'Unhandled test route' })
    }
    return handler()
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

const LOGIN_OK = () =>
  jsonResponse(200, {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: '2026-01-01T00:00:00Z',
  })
const ME_OK = () => jsonResponse(200, USER)
const REFRESH_OK = () =>
  jsonResponse(200, {
    accessToken: 'access-2',
    refreshToken: 'refresh-2',
    expiresAt: '2026-01-01T00:00:00Z',
  })
const UNAUTHORIZED = () => jsonResponse(401, { status: 401, title: 'Unauthorized' })

describe('authStore network actions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    clearTokens()
    queryClient.clear()
    // The store registers its session handler at creation; reset the bus and
    // the global toast store so each test observes exactly one handler/toast.
    clearSessionTerminatedHandlers()
    useToast().clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('login success stores tokens (memory + localStorage) and loads the user', async () => {
    const store = useAuthStore()
    const calls = stubAuthFetch({ '/api/auth/login': LOGIN_OK, '/api/auth/me': ME_OK })

    await store.login({ email: 'a@b.co', password: 'hunter2' })

    expect(store.isAuthenticated).toBe(true)
    expect(store.user).toEqual(USER)
    expect(getAccessToken()).toBe('access-1')
    expect(getRefreshToken()).toBe('refresh-1')
    expect(calls.map((c) => c.url)).toEqual(['/api/auth/login', '/api/auth/me'])
  })

  it('login with invalid credentials rejects with the 401 ApiError and clears nothing it did not set', async () => {
    const store = useAuthStore()
    stubAuthFetch({
      '/api/auth/login': UNAUTHORIZED,
      '/api/auth/me': ME_OK,
    })

    const error = await store.login({ email: 'a@b.co', password: 'wrong' }).catch((e: unknown) => e)

    expect(isApiError(error)).toBe(true)
    expect((error as ApiError).status).toBe(401)
    expect(store.user).toBeNull()
    expect(store.isAuthenticated).toBe(false)
    expect(getAccessToken()).toBeNull()
  })

  it('register posts the account then auto-logs in (204 body tolerated)', async () => {
    const store = useAuthStore()
    const noContent = {
      ok: true,
      status: 204,
      text: async () => '',
      json: async () => {
        throw new SyntaxError('empty')
      },
    } as unknown as Response
    const calls = stubAuthFetch({
      '/api/auth/register': () => noContent,
      '/api/auth/login': LOGIN_OK,
      '/api/auth/me': ME_OK,
    })

    await store.register({ email: 'a@b.co', password: 'hunter2', displayName: 'Ada' })

    expect(store.isAuthenticated).toBe(true)
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /api/auth/register',
      'POST /api/auth/login',
      'GET /api/auth/me',
    ])
  })

  it('bootstrap without a stored refresh token returns false without any network call', async () => {
    const store = useAuthStore()
    const calls = stubAuthFetch({})

    await expect(store.bootstrap()).resolves.toBe(false)
    expect(calls).toHaveLength(0)
    expect(store.isLoading).toBe(false)
  })

  it('bootstrap with a valid refresh token rotates the session and loads the user', async () => {
    setRefreshToken('refresh-old')
    const store = useAuthStore()
    const calls = stubAuthFetch({ '/api/auth/refresh': REFRESH_OK, '/api/auth/me': ME_OK })

    await expect(store.bootstrap()).resolves.toBe(true)

    expect(store.isAuthenticated).toBe(true)
    expect(store.user).toEqual(USER)
    expect(getAccessToken()).toBe('access-2')
    expect(getRefreshToken()).toBe('refresh-2')
    expect(calls.map((c) => c.url)).toEqual(['/api/auth/refresh', '/api/auth/me'])
    expect(store.isLoading).toBe(false)
  })

  it('bootstrap with an expired refresh token clears the session and empties localStorage', async () => {
    setRefreshToken('refresh-old')
    const store = useAuthStore()
    stubAuthFetch({ '/api/auth/refresh': UNAUTHORIZED })

    await expect(store.bootstrap()).resolves.toBe(false)

    expect(store.user).toBeNull()
    expect(store.isAuthenticated).toBe(false)
    expect(getAccessToken()).toBeNull()
    expect(localStorage.getItem('postit.refreshToken')).toBeNull()
    expect(store.isLoading).toBe(false)
  })

  it('logout is best-effort: a rejected network call still clears tokens, user and the query cache', async () => {
    const store = useAuthStore()
    store.setTokens(TOKENS)
    store.setUser(USER)
    queryClient.setQueryData(['boards'], [{ id: 'b1' }])
    expect(queryClient.getQueryData(['boards'])).toBeDefined()

    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async () => {
        throw new Error('offline')
      }),
    )

    await store.logout()

    expect(store.user).toBeNull()
    expect(store.isAuthenticated).toBe(false)
    expect(getAccessToken()).toBeNull()
    expect(localStorage.getItem('postit.refreshToken')).toBeNull()
    expect(queryClient.getQueryData(['boards'])).toBeUndefined()
  })

  it('logout posts the stored refresh token (backend RefreshRequest contract) and clears the cache', async () => {
    const store = useAuthStore()
    store.setTokens(TOKENS)
    store.setUser(USER)
    queryClient.setQueryData(['boards'], [{ id: 'b1' }])
    const calls = stubAuthFetch({ '/api/auth/logout': () => jsonResponse(204, null) })

    await store.logout()

    expect(calls).toEqual([
      {
        url: '/api/auth/logout',
        method: 'POST',
        body: JSON.stringify({ refreshToken: 'refresh-1' }),
      },
    ])
    expect(store.isAuthenticated).toBe(false)
    expect(queryClient.getQueryData(['boards'])).toBeUndefined()
  })

  // ── Review fixes ───────────────────────────────────────────────────────

  it('login half-state: tokens issued then GET /me fails → session fully cleared, ProfileLoadError thrown', async () => {
    const store = useAuthStore()
    stubAuthFetch({
      '/api/auth/login': LOGIN_OK,
      '/api/auth/me': () => jsonResponse(500, { status: 500, title: 'Boom' }),
    })

    const error = await store.login({ email: 'a@b.co', password: 'hunter2' }).catch((e) => e)

    expect(isProfileLoadError(error)).toBe(true)
    expect(store.user).toBeNull()
    expect(store.isAuthenticated).toBe(false)
    expect(getAccessToken()).toBeNull()
    expect(localStorage.getItem('postit.refreshToken')).toBeNull()
  })

  it('bootstrap half-state: refresh ok but GET /me fails → false and no leftover tokens', async () => {
    setRefreshToken('refresh-old')
    const store = useAuthStore()
    stubAuthFetch({
      '/api/auth/refresh': REFRESH_OK,
      '/api/auth/me': () => jsonResponse(500, { status: 500, title: 'Boom' }),
    })

    await expect(store.bootstrap()).resolves.toBe(false)
    expect(store.user).toBeNull()
    expect(getAccessToken()).toBeNull()
    expect(localStorage.getItem('postit.refreshToken')).toBeNull()
  })

  it('terminal refresh failure mid-session → full logout immediately (user, tokens, cache) + error toast', async () => {
    const store = useAuthStore()
    store.setTokens(TOKENS)
    store.setUser(USER)
    queryClient.setQueryData(['boards'], [{ id: 'b1' }])

    // Mid-session read 401s; the automatic refresh is terminal-failed (401).
    stubAuthFetch({
      '/api/boards': UNAUTHORIZED,
      '/api/auth/refresh': UNAUTHORIZED,
    })

    await expect(apiClient('GET', '/api/boards')).rejects.toThrow(ApiError)

    // The session bus handler registered by the store already cleaned up —
    // no waiting for the next navigation.
    expect(store.user).toBeNull()
    expect(store.isAuthenticated).toBe(false)
    expect(getAccessToken()).toBeNull()
    expect(localStorage.getItem('postit.refreshToken')).toBeNull()
    expect(queryClient.getQueryData(['boards'])).toBeUndefined()

    const toasts = useToast().toasts.value
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.variant).toBe('error')
    expect(toasts[0]!.message).toBe('Session expired, please log in again')
  })
})
