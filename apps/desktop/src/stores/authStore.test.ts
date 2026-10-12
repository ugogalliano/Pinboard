import { beforeEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
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
import { API_URLS } from '@/shared/constants/urls'
import { server } from '../../test/msw/server'
import { requestLog } from '../../test/msw/requests'
import type { LoginResponse, MeResponse } from '@/shared/types/api'

const TOKENS: LoginResponse = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: '2026-01-01T00:00:00Z',
}

const USER: MeResponse = { id: 'u1', email: 'a@b.co', displayName: 'Ada' }

/** The baseline 401 ProblemDetails the auth endpoints answer with. */
function unauthorized(): Response {
  return HttpResponse.json({ status: 401, title: 'Unauthorized' }, { status: 401 })
}

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
  // Exercised end-to-end through apiClient against MSW handlers, so the real
  // refresh-skip rules and token plumbing are covered too.
})

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

  it('login success stores tokens (memory + localStorage) and loads the user', async () => {
    const store = useAuthStore()
    server.use(
      http.post(API_URLS.auth.login, () => HttpResponse.json(TOKENS)),
      http.get(API_URLS.auth.me, () => HttpResponse.json(USER)),
    )

    await store.login({ email: 'a@b.co', password: 'hunter2' })

    expect(store.isAuthenticated).toBe(true)
    expect(store.user).toEqual(USER)
    expect(getAccessToken()).toBe('access-1')
    expect(getRefreshToken()).toBe('refresh-1')
    expect(requestLog.map((entry) => entry.url)).toEqual([API_URLS.auth.login, API_URLS.auth.me])
  })

  it('login with invalid credentials rejects with the 401 ApiError and clears nothing it did not set', async () => {
    const store = useAuthStore()
    server.use(
      http.post(API_URLS.auth.login, () => unauthorized()),
      http.get(API_URLS.auth.me, () => HttpResponse.json(USER)),
    )

    const error = await store.login({ email: 'a@b.co', password: 'wrong' }).catch((e: unknown) => e)

    expect(isApiError(error)).toBe(true)
    expect((error as ApiError).status).toBe(401)
    expect(store.user).toBeNull()
    expect(store.isAuthenticated).toBe(false)
    expect(getAccessToken()).toBeNull()
  })

  it('register posts the account then auto-logs in (204 body tolerated)', async () => {
    const store = useAuthStore()
    server.use(
      http.post(API_URLS.auth.register, () => new HttpResponse(null, { status: 204 })),
      http.post(API_URLS.auth.login, () => HttpResponse.json(TOKENS)),
      http.get(API_URLS.auth.me, () => HttpResponse.json(USER)),
    )

    await store.register({ email: 'a@b.co', password: 'hunter2', displayName: 'Ada' })

    expect(store.isAuthenticated).toBe(true)
    expect(requestLog.map((entry) => `${entry.method} ${entry.url}`)).toEqual([
      `POST ${API_URLS.auth.register}`,
      `POST ${API_URLS.auth.login}`,
      `GET ${API_URLS.auth.me}`,
    ])
  })

  it('bootstrap without a stored refresh token returns false without any network call', async () => {
    const store = useAuthStore()

    await expect(store.bootstrap()).resolves.toBe(false)
    expect(requestLog).toHaveLength(0)
    expect(store.isLoading).toBe(false)
  })

  it('bootstrap with a valid refresh token rotates the session and loads the user', async () => {
    setRefreshToken('refresh-old')
    const store = useAuthStore()
    server.use(
      http.post(API_URLS.auth.refresh, () =>
        HttpResponse.json({
          accessToken: 'access-2',
          refreshToken: 'refresh-2',
          expiresAt: '2026-01-01T00:00:00Z',
        }),
      ),
      http.get(API_URLS.auth.me, () => HttpResponse.json(USER)),
    )

    await expect(store.bootstrap()).resolves.toBe(true)

    expect(store.isAuthenticated).toBe(true)
    expect(store.user).toEqual(USER)
    expect(getAccessToken()).toBe('access-2')
    expect(getRefreshToken()).toBe('refresh-2')
    expect(requestLog.map((entry) => entry.url)).toEqual([API_URLS.auth.refresh, API_URLS.auth.me])
    expect(store.isLoading).toBe(false)
  })

  it('bootstrap with an expired refresh token clears the session and empties localStorage', async () => {
    setRefreshToken('refresh-old')
    const store = useAuthStore()
    server.use(http.post(API_URLS.auth.refresh, () => unauthorized()))

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

    // A network-level failure (fetch rejects), not an HTTP error status.
    server.use(http.post(API_URLS.auth.logout, () => HttpResponse.error()))

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
    let logoutBody: string | undefined
    server.use(
      http.post(API_URLS.auth.logout, async ({ request }) => {
        logoutBody = await request.text()
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await store.logout()

    expect(logoutBody).toBe(JSON.stringify({ refreshToken: 'refresh-1' }))
    expect(requestLog).toEqual([{ method: 'POST', url: API_URLS.auth.logout }])
    expect(store.isAuthenticated).toBe(false)
    expect(queryClient.getQueryData(['boards'])).toBeUndefined()
  })

  // ── Review fixes ───────────────────────────────────────────────────────

  it('login half-state: tokens issued then GET /me fails → session fully cleared, ProfileLoadError thrown', async () => {
    const store = useAuthStore()
    server.use(
      http.post(API_URLS.auth.login, () => HttpResponse.json(TOKENS)),
      http.get(API_URLS.auth.me, () =>
        HttpResponse.json({ status: 500, title: 'Boom' }, { status: 500 }),
      ),
    )

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
    server.use(
      http.post(API_URLS.auth.refresh, () =>
        HttpResponse.json({
          accessToken: 'access-2',
          refreshToken: 'refresh-2',
          expiresAt: '2026-01-01T00:00:00Z',
        }),
      ),
      http.get(API_URLS.auth.me, () =>
        HttpResponse.json({ status: 500, title: 'Boom' }, { status: 500 }),
      ),
    )

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
    server.use(
      http.get(API_URLS.boards.list, () => unauthorized()),
      http.post(API_URLS.auth.refresh, () => unauthorized()),
    )

    await expect(apiClient('GET', API_URLS.boards.list)).rejects.toThrow(ApiError)

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
