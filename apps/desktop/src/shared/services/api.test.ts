import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

import {
  ApiError,
  apiClient,
  isApiError,
  mapApiErrorStatus,
  mapApiErrorToMessage,
  mapProblemErrors,
} from './api'
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
} from './token'
import { API_URLS } from '../constants/urls'
import { server } from '../../../test/msw/server'
import { callsTo } from '../../../test/msw/requests'
import type { BoardDto, ProblemDetails } from '../types/api'

const BOARDS: BoardDto[] = [
  { id: 'b1', name: 'Launch', createdBy: 'u1', createdAt: '', updatedAt: '' },
]

/** The baseline "stale token" response reused across the refresh tests. */
function unauthorized(): Response {
  return HttpResponse.json({ status: 401, title: 'Unauthorized' }, { status: 401 })
}

describe('apiClient', () => {
  beforeEach(() => {
    localStorage.clear()
    clearTokens()
  })

  it('GET success parses typed JSON', async () => {
    let captured: { method: string; body: string; contentType: string | null } | undefined
    server.use(
      http.get(API_URLS.boards.list, async ({ request }) => {
        captured = {
          method: request.method,
          body: await request.text(),
          contentType: request.headers.get('Content-Type'),
        }
        return HttpResponse.json(BOARDS)
      }),
    )

    const result = await apiClient<BoardDto[]>('GET', API_URLS.boards.list)

    expect(result).toEqual(BOARDS)
    expect(callsTo(API_URLS.boards.list)).toHaveLength(1)
    expect(captured!.method).toBe('GET')
    expect(captured!.body).toBe('')
    expect(captured!.contentType).toBe('application/json')
  })

  it('204 returns undefined before any JSON parsing', async () => {
    server.use(
      http.delete(API_URLS.boards.detail('b1'), () => new HttpResponse(null, { status: 204 })),
    )

    // A 204 has no body to parse: the client resolves undefined and never
    // attempts JSON (the real Response carries no payload).
    await expect(apiClient<void>('DELETE', API_URLS.boards.detail('b1'))).resolves.toBeUndefined()
  })

  it('200 with an empty body returns undefined', async () => {
    server.use(
      http.get(API_URLS.boards.detail('b1'), () => new HttpResponse(null, { status: 200 })),
    )

    await expect(apiClient('GET', API_URLS.boards.detail('b1'))).resolves.toBeUndefined()
  })

  it('only serializes a body when one is provided', async () => {
    let getBody: string | undefined
    let postBody: string | undefined
    server.use(
      http.get(API_URLS.boards.list, async ({ request }) => {
        getBody = await request.text()
        return HttpResponse.json([])
      }),
      http.post(API_URLS.boards.list, async ({ request }) => {
        postBody = await request.text()
        return HttpResponse.json(BOARDS[0], { status: 201 })
      }),
    )

    await apiClient('GET', API_URLS.boards.list)
    await apiClient('POST', API_URLS.boards.list, { name: 'Launch' })

    expect(getBody).toBe('')
    expect(postBody).toBe(JSON.stringify({ name: 'Launch' }))
  })

  it('attaches Authorization when an access token exists and omits it otherwise', async () => {
    const authorizations: Array<string | null> = []
    server.use(
      http.get(API_URLS.boards.list, ({ request }) => {
        authorizations.push(request.headers.get('Authorization'))
        return HttpResponse.json([])
      }),
    )

    await apiClient('GET', API_URLS.boards.list)
    expect(authorizations[0]).toBeNull()

    setAccessToken('tok-123')
    await apiClient('GET', API_URLS.boards.list)
    expect(authorizations[1]).toBe('Bearer tok-123')
  })

  it('400 with ProblemDetails throws ApiError carrying the problem and the mapped message', async () => {
    const problem: ProblemDetails = {
      type: 'https://errors/postit/validation',
      title: 'One or more validation errors occurred.',
      status: 400,
      detail: 'Board name is required.',
      errors: { name: ['Name is required'] },
    }
    server.use(http.post(API_URLS.boards.list, () => HttpResponse.json(problem, { status: 400 })))

    const error = await apiClient('POST', API_URLS.boards.list, { name: '' }).catch(
      (e: unknown) => e,
    )

    expect(isApiError(error)).toBe(true)
    const apiError = error as ApiError
    expect(apiError.status).toBe(400)
    expect(apiError.problem.detail).toBe('Board name is required.')
    expect(apiError.problem.errors).toEqual({ name: ['Name is required'] })
    expect(apiError.message).toBe('Invalid input: Board name is required.')
  })

  it('502 with an HTML body synthesizes a safe ProblemDetails and leaks no raw HTML', async () => {
    const html =
      '<html><head><title>502 Bad Gateway</title></head><body>nginx internal secret</body></html>'
    server.use(
      http.get(
        API_URLS.boards.list,
        () => new HttpResponse(html, { status: 502, headers: { 'Content-Type': 'text/html' } }),
      ),
    )

    const error = await apiClient('GET', API_URLS.boards.list).catch((e: unknown) => e)

    expect(isApiError(error)).toBe(true)
    const apiError = error as ApiError
    expect(apiError.status).toBe(502)
    expect(apiError.problem.title).toBe('Unexpected error')
    expect(apiError.problem.detail).toBe('Something went wrong. Please try again.')
    expect(apiError.message).toBe('Something went wrong. Please try again.')
    expect(apiError.message).not.toContain('nginx')
    expect(apiError.message).not.toContain('<html')
    expect(apiError.problem.detail).not.toContain('<html')
  })

  it('401 refreshes the token, rotates the refresh token and retries the original once', async () => {
    setAccessToken('stale')
    setRefreshToken('r1')

    let refresh: { authorization: string | null; body: string } | undefined
    const authorizations: Array<string | null> = []
    let boardsCalls = 0

    server.use(
      http.post(API_URLS.auth.refresh, async ({ request }) => {
        refresh = {
          authorization: request.headers.get('Authorization'),
          body: await request.text(),
        }
        return HttpResponse.json({
          accessToken: 'fresh',
          refreshToken: 'r2',
          expiresAt: '2026-01-01T00:00:00Z',
        })
      }),
      http.get(API_URLS.boards.list, ({ request }) => {
        boardsCalls += 1
        authorizations.push(request.headers.get('Authorization'))
        if (boardsCalls === 1) return unauthorized()
        return HttpResponse.json(BOARDS)
      }),
    )

    const result = await apiClient<BoardDto[]>('GET', API_URLS.boards.list)

    expect(result).toEqual(BOARDS)
    expect(callsTo(API_URLS.boards.list)).toHaveLength(2)

    // Refresh goes out WITHOUT the stale Authorization header and with the stored refresh token.
    expect(refresh!.authorization).toBeNull()
    expect(refresh!.body).toBe(JSON.stringify({ refreshToken: 'r1' }))

    // The retry carries the rotated access token; tokens are updated everywhere.
    expect(authorizations[1]).toBe('Bearer fresh')
    expect(getAccessToken()).toBe('fresh')
    expect(getRefreshToken()).toBe('r2')
  })

  it('two concurrent 401s share a single refresh call (single-flight)', async () => {
    setAccessToken('stale')
    setRefreshToken('r1')

    let refreshCalls = 0
    const firstAttempts = new Set<string>()
    server.use(
      http.post(API_URLS.auth.refresh, () => {
        refreshCalls += 1
        return HttpResponse.json({ accessToken: 'fresh', refreshToken: 'r2', expiresAt: '' })
      }),
      http.get(API_URLS.boards.list, () => {
        if (!firstAttempts.has('list')) {
          firstAttempts.add('list')
          return unauthorized()
        }
        return HttpResponse.json(BOARDS)
      }),
      http.get(API_URLS.boards.detail('b1'), () => {
        if (!firstAttempts.has('b1')) {
          firstAttempts.add('b1')
          return unauthorized()
        }
        return HttpResponse.json(BOARDS)
      }),
    )

    const [a, b] = await Promise.all([
      apiClient<BoardDto[]>('GET', API_URLS.boards.list),
      apiClient<BoardDto[]>('GET', API_URLS.boards.detail('b1')),
    ])

    expect(a).toEqual(BOARDS)
    expect(b).toEqual(BOARDS)
    expect(refreshCalls).toBe(1)
    expect(callsTo(API_URLS.boards.list)).toHaveLength(2)
    expect(callsTo(API_URLS.boards.detail('b1'))).toHaveLength(2)
  })

  it('refresh failure clears tokens, throws the original 401 and never retries', async () => {
    setAccessToken('stale')
    setRefreshToken('r1')

    server.use(
      http.post(API_URLS.auth.refresh, () => unauthorized()),
      http.get(API_URLS.boards.list, () =>
        HttpResponse.json(
          { status: 401, title: 'Unauthorized', detail: 'bad token' },
          { status: 401 },
        ),
      ),
    )

    const error = await apiClient('GET', API_URLS.boards.list).catch((e: unknown) => e)

    expect(isApiError(error)).toBe(true)
    expect((error as ApiError).status).toBe(401)
    expect(callsTo(API_URLS.boards.list)).toHaveLength(1) // original NOT retried
    expect(getAccessToken()).toBeNull()
    expect(localStorage.getItem('postit.refreshToken')).toBeNull()
  })

  it('a second 401 after the retry is terminal (exactly one retry)', async () => {
    setAccessToken('stale')
    setRefreshToken('r1')

    server.use(
      http.post(API_URLS.auth.refresh, () =>
        HttpResponse.json({ accessToken: 'fresh', refreshToken: 'r2', expiresAt: '' }),
      ),
      http.get(API_URLS.boards.list, () => unauthorized()),
    )

    await expect(apiClient('GET', API_URLS.boards.list)).rejects.toThrow(ApiError)
    expect(callsTo(API_URLS.boards.list)).toHaveLength(2)
  })

  it('refresh returning 200 with an HTML/malformed body clears tokens and throws the terminal 401', async () => {
    setAccessToken('stale')
    setRefreshToken('r1')

    server.use(
      http.post(
        API_URLS.auth.refresh,
        () =>
          // "successful" status but an HTML gateway page — res.json() must throw.
          new HttpResponse('<html><body>proxy login page</body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
      http.get(API_URLS.boards.list, () => unauthorized()),
    )

    const error = await apiClient('GET', API_URLS.boards.list).catch((e: unknown) => e)

    expect(isApiError(error)).toBe(true)
    expect((error as ApiError).status).toBe(401)
    expect(getAccessToken()).toBeNull()
    expect(localStorage.getItem('postit.refreshToken')).toBeNull()
    // Refresh never succeeded, so the original request is NOT retried.
    expect(callsTo(API_URLS.boards.list)).toHaveLength(1)
  })

  it('401 on /api/auth/login surfaces directly — NO refresh attempt', async () => {
    setRefreshToken('r1')

    server.use(
      http.post(API_URLS.auth.refresh, () =>
        // Would "succeed" if attempted — the point is it must never be called.
        HttpResponse.json({ accessToken: 'fresh', refreshToken: 'r2', expiresAt: '' }),
      ),
      http.post(API_URLS.auth.login, () =>
        HttpResponse.json(
          { status: 401, title: 'Unauthorized', detail: 'bad credentials' },
          { status: 401 },
        ),
      ),
    )

    const error = await apiClient('POST', API_URLS.auth.login, {
      email: 'a@b.co',
      password: 'wrong',
    }).catch((e: unknown) => e)

    expect(isApiError(error)).toBe(true)
    expect((error as ApiError).status).toBe(401)
    expect(callsTo(API_URLS.auth.login)).toHaveLength(1)
    expect(callsTo(API_URLS.auth.refresh)).toHaveLength(0)
    // Tokens are untouched — a failed login must not clear the stored session.
    expect(getRefreshToken()).toBe('r1')
  })

  it('401 on /api/auth/register also skips the refresh cycle', async () => {
    setRefreshToken('r1')

    server.use(
      http.post(API_URLS.auth.refresh, () =>
        HttpResponse.json({ accessToken: 'fresh', refreshToken: 'r2', expiresAt: '' }),
      ),
      http.post(API_URLS.auth.register, () => HttpResponse.json({ status: 401 }, { status: 401 })),
    )

    await expect(apiClient('POST', API_URLS.auth.register, { email: 'a@b.co' })).rejects.toThrow(
      ApiError,
    )
    expect(callsTo(API_URLS.auth.refresh)).toHaveLength(0)
  })

  it('GET /api/auth/me keeps the refresh+retry cycle (stale access token mid-session)', async () => {
    setAccessToken('stale')
    setRefreshToken('r1')

    let meCalls = 0
    server.use(
      http.post(API_URLS.auth.refresh, () =>
        HttpResponse.json({ accessToken: 'fresh', refreshToken: 'r2', expiresAt: '' }),
      ),
      http.get(API_URLS.auth.me, () => {
        meCalls += 1
        if (meCalls === 1) return unauthorized()
        return HttpResponse.json({ id: 'u1', email: 'a@b.co', displayName: 'Ada' })
      }),
    )

    const me = await apiClient<{ id: string }>('GET', API_URLS.auth.me)

    expect(me).toEqual({ id: 'u1', email: 'a@b.co', displayName: 'Ada' })
    expect(callsTo(API_URLS.auth.refresh)).toHaveLength(1)
    expect(callsTo(API_URLS.auth.me)).toHaveLength(2)
  })

  it('GET /api/auth/me?with-query keeps the refresh cycle (match ignores query string)', async () => {
    setAccessToken('stale')
    setRefreshToken('r1')

    let meCalls = 0
    server.use(
      http.post(API_URLS.auth.refresh, () =>
        HttpResponse.json({ accessToken: 'fresh', refreshToken: 'r2', expiresAt: '' }),
      ),
      http.get(API_URLS.auth.me, () => {
        meCalls += 1
        if (meCalls === 1) return unauthorized()
        return HttpResponse.json({ id: 'u1' })
      }),
    )

    await expect(apiClient('GET', '/api/auth/me?fields=full')).resolves.toEqual({ id: 'u1' })
    expect(callsTo(API_URLS.auth.refresh)).toHaveLength(1)
    expect(callsTo('/api/auth/me?fields=full')).toHaveLength(2)
  })

  it('POST /api/auth/me (non-GET) skips the refresh cycle — exemption is GET-only', async () => {
    setRefreshToken('r1')

    server.use(
      http.post(API_URLS.auth.refresh, () =>
        HttpResponse.json({ accessToken: 'fresh', refreshToken: 'r2', expiresAt: '' }),
      ),
      http.post(API_URLS.auth.me, () => unauthorized()),
    )

    await expect(apiClient('POST', API_URLS.auth.me)).rejects.toThrow(ApiError)
    expect(callsTo(API_URLS.auth.refresh)).toHaveLength(0)
  })

  it('a terminal refresh failure notifies the session bus (full logout hook)', async () => {
    const { onSessionTerminated, clearSessionTerminatedHandlers } = await import('./session')
    setAccessToken('stale')
    setRefreshToken('r1')
    const handler = vi.fn<() => void>()
    onSessionTerminated(handler)

    server.use(
      http.post(API_URLS.auth.refresh, () => unauthorized()),
      http.get(API_URLS.boards.list, () => unauthorized()),
    )

    await expect(apiClient('GET', API_URLS.boards.list)).rejects.toThrow(ApiError)
    expect(handler).toHaveBeenCalledTimes(1)
    clearSessionTerminatedHandlers()
  })

  it('a normal (non-auth) endpoint still refreshes and retries on 401', async () => {
    setAccessToken('stale')
    setRefreshToken('r1')

    let boardsCalls = 0
    server.use(
      http.post(API_URLS.auth.refresh, () =>
        HttpResponse.json({ accessToken: 'fresh', refreshToken: 'r2', expiresAt: '' }),
      ),
      http.get(API_URLS.boards.list, () => {
        boardsCalls += 1
        if (boardsCalls === 1) return unauthorized()
        return HttpResponse.json(BOARDS)
      }),
    )

    await expect(apiClient<BoardDto[]>('GET', API_URLS.boards.list)).resolves.toEqual(BOARDS)
    expect(callsTo(API_URLS.auth.refresh)).toHaveLength(1)
  })
})

describe('mapProblemErrors', () => {
  it('lowercases PascalCase/dotted keys to field names and keeps the first message', () => {
    expect(
      mapProblemErrors({
        status: 400,
        errors: {
          Email: ['Email is already taken', 'second'],
          'RegisterRequest.Password': ['Password is too short'],
        },
      }),
    ).toEqual({
      email: 'Email is already taken',
      password: 'Password is too short',
    })
  })

  it('drops entries without a usable message', () => {
    expect(mapProblemErrors({ status: 400, errors: { Name: [] } })).toEqual({})
  })

  it('returns an empty record when the problem has no errors dict', () => {
    expect(mapProblemErrors({ status: 400, detail: 'Invalid input' })).toEqual({})
  })
})

describe('mapApiErrorStatus', () => {
  it('implements the AGENTS.md §4 table', () => {
    expect(mapApiErrorStatus(400, 'Name too long')).toBe('Invalid input: Name too long')
    expect(mapApiErrorStatus(400)).toBe('Invalid input')
    expect(mapApiErrorStatus(401)).toBe('Session expired, please log in again')
    expect(mapApiErrorStatus(403)).toBe("You don't have permission for this action")
    expect(mapApiErrorStatus(404)).toBe('Resource not found')
    expect(mapApiErrorStatus(409)).toBe('This action conflicts with current state')
    expect(mapApiErrorStatus(500)).toBe('Something went wrong. Please try again.')
    expect(mapApiErrorStatus(503)).toBe('Something went wrong. Please try again.')
  })

  it('maps 401 detail to the safe generic text (detail never leaks for auth statuses)', () => {
    expect(mapApiErrorStatus(401, 'raw token rejected because xyz')).toBe(
      'Session expired, please log in again',
    )
  })
})

describe('mapApiErrorToMessage', () => {
  it('falls back to the generic status-0 message for non-ApiError input', () => {
    expect(mapApiErrorToMessage(new Error('network down'))).toBe(
      'Something went wrong. Please try again.',
    )
    expect(mapApiErrorToMessage('a string')).toBe('Something went wrong. Please try again.')
    expect(mapApiErrorToMessage(undefined)).toBe('Something went wrong. Please try again.')
  })
})
