import { beforeEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'

import { createAppRouter } from '@/app/router'
import { useAuthStore } from '@/stores/authStore'
import { getAccessToken, setAccessToken, setRefreshToken } from '@/shared/services/token'
import { API_URLS } from '@/shared/constants/urls'
import { server } from '../../../test/msw/server'
import { callsTo, requestLog } from '../../../test/msw/requests'
import type { LoginResponse, MeResponse } from '@/shared/types/api'

const NEW_TOKENS: LoginResponse = {
  accessToken: 'access-new',
  refreshToken: 'refresh-new',
  expiresAt: '2026-01-01T00:00:00Z',
}
const USER: MeResponse = { id: 'u1', email: 'a@b.co', displayName: 'Ada' }

describe('router guard', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('awaits bootstrap on the first navigation and lets a refreshed session through', async () => {
    setRefreshToken('refresh-old')
    const router = createAppRouter(createMemoryHistory())

    server.use(
      http.post(API_URLS.auth.refresh, () => HttpResponse.json(NEW_TOKENS)),
      http.get(API_URLS.auth.me, () => HttpResponse.json(USER)),
    )
    await router.push('/')

    // Bootstrap ran exactly once (refresh + /me), landing on the protected route.
    expect(requestLog.map((entry) => entry.url)).toEqual([API_URLS.auth.refresh, API_URLS.auth.me])
    expect(router.currentRoute.value.path).toBe('/')
    expect(useAuthStore().isAuthenticated).toBe(true)

    // A second protected navigation must NOT bootstrap again.
    await router.push('/register') // guestOnly + authenticated → bounced to /
    await router.push('/')
    expect(requestLog).toHaveLength(2)
  })

  it('redirects unauthenticated users from the root to /login WITHOUT ?redirect noise', async () => {
    const router = createAppRouter(createMemoryHistory())

    await router.push('/')

    expect(router.currentRoute.value.path).toBe('/login')
    expect(router.currentRoute.value.query.redirect).toBeUndefined()
  })

  it('carries ?redirect= for protected deep links where it adds information', async () => {
    const router = createAppRouter(createMemoryHistory())

    await router.push('/?tab=board')

    expect(router.currentRoute.value.path).toBe('/login')
    expect(router.currentRoute.value.query.redirect).toBe('/?tab=board')
  })

  it('concurrent first navigations share ONE bootstrap and the second lands authenticated', async () => {
    setRefreshToken('refresh-old')
    // Slow bootstrap: the refresh response resolves on a timer so both
    // guards enter beforeEach while the first one is still awaiting.
    server.use(
      http.post(API_URLS.auth.refresh, async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        return HttpResponse.json(NEW_TOKENS)
      }),
      http.get(API_URLS.auth.me, () => HttpResponse.json(USER)),
    )

    const router = createAppRouter(createMemoryHistory())
    const first = router.push('/')
    // Second navigation starts while the first guard is mid-bootstrap:
    // with a boolean flag it would read isAuthenticated=false and bounce
    // /register to /login; with a shared promise it waits properly.
    const second = router.push('/register')
    await Promise.all([first, second])

    // Bootstrap ran exactly once, and being authenticated the guest-only
    // screen bounced to "/" — NOT to /login.
    expect(callsTo(API_URLS.auth.refresh)).toHaveLength(1)
    expect(router.currentRoute.value.path).toBe('/')
    expect(useAuthStore().isAuthenticated).toBe(true)
  })

  it('bounces authenticated users away from guest-only screens to /', async () => {
    const auth = useAuthStore()
    // In-memory session only (no refresh token) so bootstrap no-ops quickly.
    setAccessToken('access-live')
    auth.setUser(USER)

    const router = createAppRouter(createMemoryHistory())
    await router.push('/login')

    expect(router.currentRoute.value.path).toBe('/')
    expect(getAccessToken()).toBe('access-live')
  })

  it('serves the auth screens to guests', async () => {
    const router = createAppRouter(createMemoryHistory())

    await router.push('/login')
    expect(router.currentRoute.value.path).toBe('/login')

    await router.push('/register')
    expect(router.currentRoute.value.path).toBe('/register')
  })

  it('redirects unknown paths to / (then to /login for guests)', async () => {
    const router = createAppRouter(createMemoryHistory())

    await router.push('/totally-unknown')

    expect(router.currentRoute.value.path).toBe('/login')
  })

  it('protects the board shell at "/" (BoardLayout)', async () => {
    const router = createAppRouter(createMemoryHistory())

    await router.push('/')

    expect(router.currentRoute.value.path).toBe('/login')
    expect(router.currentRoute.value.query.redirect).toBeUndefined()
  })

  it('protects a board deep link and carries ?redirect=/boards/:boardId', async () => {
    const router = createAppRouter(createMemoryHistory())

    await router.push('/boards/b1')

    expect(router.currentRoute.value.path).toBe('/login')
    expect(router.currentRoute.value.query.redirect).toBe('/boards/b1')
  })

  it('protects the board-members child route and keeps the named members destination', async () => {
    const guestRouter = createAppRouter(createMemoryHistory())
    await guestRouter.push('/boards/b1/members')

    expect(guestRouter.currentRoute.value.path).toBe('/login')
    expect(guestRouter.currentRoute.value.query.redirect).toBe('/boards/b1/members')

    const auth = useAuthStore()
    setAccessToken('access-live')
    auth.setUser(USER)
    const router = createAppRouter(createMemoryHistory())
    await router.push({ name: 'board-members', params: { boardId: 'b1' } })

    expect(router.currentRoute.value.path).toBe('/boards/b1/members')
    expect(router.currentRoute.value.name).toBe('board-members')
  })

  it('lets an authenticated user into / and into a board deep link', async () => {
    const auth = useAuthStore()
    // In-memory session (no refresh token) so bootstrap no-ops quickly.
    setAccessToken('access-live')
    auth.setUser(USER)
    // The shell renders the board list, which reads GET /api/boards.
    server.use(http.get(API_URLS.boards.list, () => HttpResponse.json([])))

    const router = createAppRouter(createMemoryHistory())

    await router.push('/')
    expect(router.currentRoute.value.path).toBe('/')

    await router.push('/boards/b1')
    expect(router.currentRoute.value.path).toBe('/boards/b1')
  })
})
